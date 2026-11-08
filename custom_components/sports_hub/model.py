"""Normalize scoreboards without Home Assistant dependencies.

All strings are untrusted provider data. The frontend escapes them before rendering.
Each competition becomes an event, including tennis matches and UFC undercards.
"""

from datetime import datetime, timezone
from .venue import venue_location
from urllib.parse import urlparse
import re


def safe_color(value):
    """Accept hex colors only; never pass provider strings into CSS."""
    value = str(value or "").removeprefix("#")
    return f"#{value.lower()}" if re.fullmatch(r"[0-9a-fA-F]{6}", value) else ""


def league_branding(payload):
    leagues = payload.get("leagues") or []
    league = leagues[0] if leagues and isinstance(leagues[0], dict) else {}
    logos = league.get("logos") or []
    logo = next((safe_url(item.get("href")) for item in logos if isinstance(item, dict) and safe_url(item.get("href"))), "")
    return {"logo": logo, "color": safe_color(league.get("color")), "alternate_color": safe_color(league.get("alternateColor"))}


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def safe_url(value):
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlparse(value)
        return value if parsed.scheme == "https" and parsed.hostname and not parsed.username else ""
    except ValueError:
        return ""


def text(value, limit=240):
    return str(value)[:limit] if value is not None else ""


def score_value(value):
    if isinstance(value, dict):
        value = value.get("displayValue", value.get("value"))
    # A missing score must stay missing, not become 0:0.
    return None if value is None or value == "" else text(value, 30)


def normalize_competitor(raw, sport):
    entity = raw.get("team") or raw.get("athlete") or raw.get("roster") or {}
    if not isinstance(entity, dict):
        entity = {}
    identifier = text(entity.get("id") or raw.get("id"), 80)
    kind = "team" if raw.get("team") or raw.get("roster") else "athlete"
    # IDs are scoped by sport and entity kind to avoid cross-sport collisions.
    uid = entity.get("uid") or raw.get("uid")
    key = f"{sport}:{uid}" if uid else f"{sport}:{kind}:{identifier}" if identifier else ""
    logos = entity.get("logos") or []
    headshot = entity.get("headshot") or {}
    logo = entity.get("logo") or (logos[0].get("href") if logos else None) or headshot.get("href") or (entity.get("flag") or {}).get("href")
    record = next((r.get("summary", "") for r in raw.get("records", []) if r.get("type") == "total"), "")
    rank = raw.get("curatedRank", {}).get("current")
    order = raw.get("order")
    try:
        order = int(order)
    except (ValueError, TypeError):
        order = 999
    return {
        "key": key, "id": identifier, "kind": kind,
        "name": text(entity.get("displayName") or entity.get("fullName") or entity.get("name") or "TBD"),
        "short_name": text(entity.get("shortDisplayName") or entity.get("abbreviation") or entity.get("displayName") or "TBD", 80),
        "abbreviation": text(entity.get("abbreviation"), 12),
        "color": safe_color(entity.get("color")), "alternate_color": safe_color(entity.get("alternateColor")),
        "logo": safe_url(logo), "home_away": text(raw.get("homeAway"), 10),
        "score": score_value(raw.get("score")), "winner": raw.get("winner") if isinstance(raw.get("winner"), bool) else None,
        "order": order, "record": text(record, 40), "rank": rank if isinstance(rank, int) and 0 < rank < 100 else None,
        "linescores": [score_value(item) for item in raw.get("linescores", [])][:12],
    }


def competitions(event):
    """Flatten tournament groupings, without counting duplicate match IDs."""
    seen = set()
    def walk(node):
        for match in node.get("competitions", []):
            key = str(match.get("id", ""))
            if key and key not in seen:
                seen.add(key)
                yield match
        for group in node.get("groupings", []):
            yield from walk(group)
    yield from walk(event)


def event_state(status):
    kind = status.get("type") or {}
    name = text(kind.get("name")).upper()
    # A delayed/suspended event can retain state='in'; never call it live.
    if any(word in name for word in ("POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED", "DELAYED", "ABANDONED", "PLAY_COMPLETE")):
        return "postponed" if "POSTPONED" in name else "interrupted"
    if kind.get("completed") is True or kind.get("state") == "post":
        return "finished"
    return "live" if kind.get("state") == "in" else "scheduled"


def normalize_scoreboard(payload, league, start, end):
    """Return all competitions overlapping the requested UTC interval [start, end)."""
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        raise ValueError("Scoreboard did not contain an events array")
    result = {}
    for event in payload["events"]:
        if not isinstance(event, dict):
            continue
        for comp in competitions(event):
            date = parse_time(comp.get("date") or comp.get("startDate") or event.get("date"))
            end_date = parse_time(comp.get("endDate") or (event.get("endDate") if league["sport"] == "golf" else None))
            if date is None or date >= end or (end_date or date) < start:
                continue
            status = comp.get("status") or event.get("status") or {}
            state = event_state(status)
            kind = status.get("type") or {}
            participants = [normalize_competitor(c, league["sport"]) for c in comp.get("competitors", []) if isinstance(c, dict)]
            is_table = league["sport"] in ("racing", "golf")
            if is_table:
                participants.sort(key=lambda c: c["order"])
            else:
                participants.sort(key=lambda c: {"home": 0, "away": 1}.get(c["home_away"], 2))
            venue = comp.get("venue") or event.get("venue") or {}
            links = comp.get("links") or event.get("links") or []
            link = next((safe_url(l.get("href")) for l in links if safe_url(l.get("href"))), "")
            notes = comp.get("notes") or []
            name = event.get("name") or event.get("shortName") or " vs ".join(p["name"] for p in participants[:2])
            comp_type = comp.get("type") or {}
            key = f"{league['id']}:{event.get('id', '')}:{comp.get('id', '')}"
            result[key] = {
                "id": key, "league_id": league["id"], "sport": league["sport"],
                "league": league["name"], "league_logo": league_branding(payload)["logo"] or safe_url(league.get("logo")), "name": text(name),
                "subtitle": text(comp_type.get("text") or comp_type.get("abbreviation") or (notes[0].get("headline") if notes else "")),
                "date": date.isoformat(), "end_date": end_date.isoformat() if end_date else None,
                "time_confirmed": comp.get("timeValid", True) and not comp.get("startTimeTBD", False),
                "state": state, "status": text(kind.get("shortDetail") or kind.get("detail") or kind.get("description"), 120),
                "clock": text(status.get("displayClock"), 20), "period": status.get("period"),
                "participants": participants, "format": "leaderboard" if is_table else "match",
                "venue": text(venue.get("fullName") or venue.get("name"), 120), "location": venue_location(venue), "url": link,
            }
    return sorted(result.values(), key=lambda e: (e["date"], e["id"]))


def refresh_seconds(events, now, failures=0):
    """Bound upstream load; live/near-start 30s, idle 15m, exponential failure backoff."""
    if failures:
        return min(60 * 2 ** min(failures - 1, 4), 900)
    for event in events:
        start = parse_time(event.get("date"))
        if event.get("state") == "live" or (event.get("state") == "scheduled" and start and -3600 <= (start - now).total_seconds() <= 900):
            return 30
    return 900
