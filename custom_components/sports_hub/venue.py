"""Public venue locations only; never use the Home Assistant home location."""
import math
import re
import unicodedata
from urllib.parse import urlencode


def coordinates(lat, lon):
    if isinstance(lat, bool) or isinstance(lon, bool) or lat in (None, '') or lon in (None, ''):
        return None
    try:
        lat, lon = float(lat), float(lon)
        if math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180:
            return {'latitude': lat, 'longitude': lon}
    except (ValueError, TypeError):
        pass
    return None


def venue_location(venue):
    venue = venue if isinstance(venue, dict) else {}
    address = venue.get('address') or {}
    point = venue.get('coordinates') or venue.get('location') or {}
    return {'name': str(venue.get('fullName') or venue.get('name') or '')[:120],
            'city': str(address.get('city') or '')[:80], 'country': str(address.get('country') or '')[:80],
            'state': str(address.get('state') or '')[:80],
            **(coordinates(point.get('latitude', point.get('lat')), point.get('longitude', point.get('lon'))) or {})}


def normalized_name(value):
    value = unicodedata.normalize('NFKD', str(value)).casefold()
    return re.sub(r'[^a-z0-9]', '', value)


def country_key(value):
    key = normalized_name(value)
    return {'usa':'us', 'unitedstates':'us', 'unitedstatesofamerica':'us',
            'england':'gb', 'scotland':'gb', 'wales':'gb', 'northernireland':'gb', 'unitedkingdom':'gb',
            'germany':'de', 'france':'fr', 'spain':'es', 'italy':'it', 'brazil':'br',
            'australia':'au', 'canada':'ca', 'japan':'jp', 'netherlands':'nl', 'austria':'at'}.get(key,key)


def photon_location(payload, venue):
    """Reject stations, fuzzy matches and ambiguous venues, even if ranked first."""
    name = normalized_name(venue.get('name', ''))
    country = country_key(venue.get('country', ''))
    candidates = []
    for feature in payload.get('features', [])[:5]:
        prop = feature.get('properties') or {}
        if prop.get('osm_key') not in ('leisure', 'building', 'amenity', 'highway'):
            continue
        if prop.get('osm_value') not in ('stadium', 'sports_centre', 'sports_hall', 'raceway', 'pitch', 'arena'):
            continue
        if normalized_name(prop.get('name', '')) != name or not name:
            continue
        if country and country not in {country_key(prop.get('country', '')), country_key(prop.get('countrycode', ''))}:
            continue
        xy = (feature.get('geometry') or {}).get('coordinates', [])
        point = coordinates(xy[1], xy[0]) if len(xy) == 2 else None
        if point:
            candidates.append({**venue, **point, 'city': prop.get('city') or venue.get('city', ''), 'source': 'OpenStreetMap / Photon'})
    if not candidates:
        return None
    first = candidates[0]
    if any(abs(p['latitude']-first['latitude']) > .02 or abs(p['longitude']-first['longitude']) > .02 for p in candidates[1:]):
        return None
    return first


async def resolve_venue(provider, venue):
    """One cached lookup for the venue being viewed, never a season-wide crawl."""
    if not venue:
        return None
    if coordinates(venue.get('latitude'), venue.get('longitude')):
        return {**venue, 'source': venue.get('source') or 'ESPN'}
    if not venue.get('name') or not venue.get('country'):
        return None
    url = 'https://photon.komoot.io/api/?' + urlencode({'q': venue['name']+' '+venue['country'], 'limit': 5, 'lang': 'en'})
    item = await provider.get(url, 7*86400)
    if item['error']:
        return None
    return photon_location(item['data'], venue)
