"""Daily scoreboard cache: bounded concurrency, partial failures and fast live refresh."""
import asyncio
from datetime import datetime, timedelta, timezone
import logging

import aiohttp

from .catalog import LEAGUES
from .const import API_ROOT, VERSION
from .model import normalize_scoreboard, parse_time, refresh_seconds, league_branding

_LOGGER = logging.getLogger(__name__)


class ScoreboardProvider:
    def __init__(self, session, league_ids, days_back=2, days_ahead=7, time_zone=timezone.utc):
        self.session = session
        self.league_ids = league_ids
        self.days_back = days_back
        self.days_ahead = days_ahead
        self.time_zone = time_zone
        self.cache = {}
        self._semaphore = asyncio.Semaphore(6)
        self._warm = False

    def window(self, now):
        midnight = now.astimezone(self.time_zone).replace(hour=0, minute=0, second=0, microsecond=0)
        return (midnight - timedelta(days=self.days_back)).astimezone(timezone.utc), (midnight + timedelta(days=self.days_ahead + 1)).astimezone(timezone.utc)

    def days(self, now, start, end):
        # Include neighboring UTC dates: US scoreboards use the provider's local day.
        first = start.date() - timedelta(days=1)
        return [first + timedelta(days=offset) for offset in range((end.date() - first).days + 1)]

    def due(self, league_id, day, now):
        cached = self.cache.get((league_id, day.isoformat()))
        if cached is None:
            return True
        deadline = cached["next_poll"]
        updated = parse_time(cached.get("updated_at"))
        if updated and not cached.get("error") and abs((day - now.date()).days) <= 1:
            # A cached future day must become live-capable as kickoff approaches.
            deadline = min(deadline, updated + timedelta(seconds=refresh_seconds(cached["events"], now)))
        return deadline <= now

    async def _fetch(self, league, day, now, start, end):
        key = (league["id"], day.isoformat())
        previous = self.cache.get(key, {})
        params = {"dates": day.strftime("%Y%m%d"), "limit": "1000", "lang": "en", "region": "us"}
        if "college-basketball" in league["path"]:
            params["groups"] = "50"
        elif league["path"] == "college-football":
            params["groups"] = "80"
        try:
            async with self._semaphore:
                async with self.session.get(
                    f"{API_ROOT}/{league['sport']}/{league['path']}/scoreboard",
                    params=params, headers={"User-Agent": f"HA-Sports-Hub/{VERSION}"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    response.raise_for_status()
                    payload = await response.json(content_type=None)
            events = normalize_scoreboard(payload, league, start, end)
            interval = refresh_seconds(events, now) if abs((day - now.date()).days) <= 1 else 21600
            self.cache[key] = {
                "events": events, "updated_at": now.isoformat(), "error": None,
                "partial": len(payload["events"]) >= 1000, "failures": 0,
                "branding": league_branding(payload),
                "next_poll": now + timedelta(seconds=interval),
            }
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError, TypeError) as err:
            failures = previous.get("failures", 0) + 1
            self.cache[key] = {
                **previous, "events": previous.get("events", []),
                "updated_at": previous.get("updated_at"), "failures": failures,
                "error": "rate_limited" if isinstance(err, aiohttp.ClientResponseError) and err.status == 429 else "unavailable",
                "next_poll": now + timedelta(seconds=refresh_seconds([], now, failures)),
            }
            if failures == 1:
                _LOGGER.debug("Scoreboard unavailable for %s on %s (%s)", league["id"], day, type(err).__name__)

    async def update(self, now=None):
        now = now or datetime.now(timezone.utc)
        start, end = self.window(now)
        all_days = self.days(now, start, end)
        # Publish today's games first. The next coordinator refresh fills the whole window.
        fetch_days = all_days if self._warm else [now.date() - timedelta(days=1), now.date(), now.date() + timedelta(days=1)]
        wanted = {(league_id, day.isoformat()) for league_id in self.league_ids for day in all_days}
        self.cache = {key: data for key, data in self.cache.items() if key in wanted}
        await asyncio.gather(*(
            self._fetch(LEAGUES[league_id], day, now, start, end)
            for league_id in self.league_ids for day in fetch_days
            if self.due(league_id, day, now)
        ))
        self._warm = True
        return self.snapshot(now)

    def snapshot(self, now=None):
        now = now or datetime.now(timezone.utc)
        start, end = self.window(now)
        days = self.days(now, start, end)
        leagues, events = [], []
        loaded = 0
        for league_id in self.league_ids:
            slices = [self.cache.get((league_id, day.isoformat())) for day in days]
            loaded += sum(s is not None for s in slices)
            present = [s for s in slices if s is not None]
            merged = {}
            for data in present:
                updated = parse_time(data.get("updated_at"))
                age = (now - updated).total_seconds() if updated else float("inf")
                for event in data["events"]:
                    event_start = parse_time(event["date"])
                    event_end = parse_time(event.get("end_date")) or event_start
                    if not event_start or not (start <= event_end and event_start < end):
                        continue
                    stale = bool(data.get("error")) or (event["state"] == "live" and age > 120)
                    candidate = {**event, "stale": stale, "updated_at": data.get("updated_at")}
                    old = merged.get(event["id"])
                    # Overlapping provider days may repeat events: prefer the latest success.
                    if old is None or (candidate["updated_at"] or "", not stale) > (old["updated_at"] or "", not old["stale"]):
                        merged[event["id"]] = candidate
            valid = list(merged.values())
            events.extend(valid)
            errors = [s["error"] for s in present if s.get("error")]
            leagues.append({
                **LEAGUES[league_id], **next((s["branding"] for s in reversed(present) if s.get("branding", {}).get("logo")), {}),
                "updated_at": max((s.get("updated_at") or "" for s in present), default="") or None,
                "error": errors[0] if errors else None, "stale": bool(errors),
                "partial": any(s.get("partial") for s in present),
                "loading": len(present) < len(days), "failed_days": len(errors),
                "event_count": len(valid), "live_count": sum(e["state"] == "live" and not e["stale"] for e in valid),
            })
        return {
            "generated_at": now.isoformat(), "time_zone": str(self.time_zone),
            "window_start": start.isoformat(), "window_end": end.isoformat(),
            "loading": loaded < len(days) * len(self.league_ids),
            "loaded_slices": loaded, "total_slices": len(days) * len(self.league_ids),
            "leagues": leagues, "events": sorted(events, key=lambda e: (e["date"], e["id"])),
        }
