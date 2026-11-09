"""Favorite-scoped schedules shared by the personal feed, calendars and reminders."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import re

from .catalog import LEAGUES
from .const import API_ROOT
from .enrichment_model import normalize_schedule, normalize_f1
from .model import parse_time


def follows(event, favorites):
    return 'league:'+event['league_id'] in favorites or any(p.get('key') in favorites for p in event.get('participants', []))


def calendar_span(event, zone):
    start = parse_time(event.get('date'))
    if not start or event.get('state') in ('postponed', 'interrupted'):
        return None
    if not event.get('time_confirmed'):
        day = start.astimezone(zone).date()
        return day, day+timedelta(days=1)
    end = parse_time(event.get('end_date'))
    if not end or end <= start:
        # Calendar block only: never present an estimated duration as the final whistle.
        end = start+timedelta(hours=3 if event.get('sport') in ('football', 'baseball', 'racing') else 2)
    return start, end


def enrich_profile_events(payload, league, profile):
    team_id = None
    if profile['kind'] == 'team':
        match = re.search(r'(?:~t:|:team:)(\d+)$', profile['target'])
        if not match:
            return []
        team_id = match.group(1)
    events = normalize_schedule(payload, league, team_id)
    for event in events:
        for p in event['participants']:
            if p['id'] == team_id:
                p['key'] = profile['target']
            elif league['sport'] == 'soccer':
                p['key'] = f"soccer:s:600~t:{p['id']}"
    return events


class AgendaProvider:
    def __init__(self, provider):
        self.provider = provider

    async def events(self, profiles, snapshot, favorites, start, end):
        events = {e['id']: deepcopy(e) for e in snapshot.get('events', []) if follows(e, favorites)}
        sources = []
        # Bound long-range requests. All favorites still use the shared live scoreboard.
        expanded = profiles[:40]
        async def schedule(profile):
            league, team_id = self.provider.resolve(profile, snapshot)
            if not league:
                return
            if league['id'] == 'racing:f1' and profile['kind'] == 'league':
                item = await self.provider.get('https://api.jolpi.ca/ergast/f1/current.json?limit=100', 3600)
                calendar = normalize_f1(item['data'], {}, {}, {})
                sources.append({'name':'Jolpica · Formula 1','stale':item['error'],'updated_at':item['updated_at']})
                for race in calendar['calendar']:
                    for session in race['sessions']:
                        date = parse_time(session['date'])
                        if not date or not start <= date < end:
                            continue
                        # Prefer actual scoreboard data for matching sessions, especially live state.
                        if any(e['league_id']=='racing:f1' and abs((parse_time(e['date'])-date).total_seconds()) < 120 for e in events.values()):
                            continue
                        key = f"jolpica:{calendar['season']}:{race['round']}:{session['name']}"
                        events[key] = {'id':key,'league_id':'racing:f1','sport':'racing','league':'Formula 1','league_logo':league.get('logo',''),
                            'name':race['name']+' · '+session['name'],'subtitle':session['name'],'date':session['date'],'end_date':None,
                            'time_confirmed':session['time_confirmed'],'state':'scheduled' if date>=datetime.now(timezone.utc) else 'finished',
                            'status':'','clock':'','period':None,'participants':[],'format':'leaderboard','venue':race['circuit'],'location':race.get('location'),
                            'url':race['url'],'updated_at':item['updated_at'],'stale':item['error'],'calendar_only':True}
                return
            if team_id:
                path = 'all' if league['sport']=='soccer' else league['path']
                root = f"{API_ROOT}/{league['sport']}/{path}/teams/{team_id}/schedule"
                urls = [root, root+'?fixture=true']
            elif profile['kind']=='league':
                # Fetch only calendar months intersecting this bounded personal window.
                cursor = start.replace(day=1); months=[]
                while cursor < end:
                    months.append(cursor.strftime('%Y%m'))
                    cursor = (cursor.replace(day=28)+timedelta(days=4)).replace(day=1)
                urls = [f"{API_ROOT}/{league['sport']}/{league['path']}/scoreboard?dates={month}&limit=1000" for month in months]
            else:
                return
            items = await asyncio.gather(*(self.provider.get(url, 1800) for url in urls))
            for item in items:
                sources.append({'name':profile['name'],'stale':item['error'],'updated_at':item['updated_at']})
                for event in enrich_profile_events(item['data'], league, profile):
                    if not follows(event, favorites):
                        continue
                    old = events.get(event['id'])
                    if old and not old.get('stale'):
                        continue
                    event.update({'updated_at':item['updated_at'],'stale':item['error']})
                    events[event['id']] = event
        await asyncio.gather(*(schedule(p) for p in expanded))
        ordered = sorted((e for e in events.values() if (date:=parse_time(e.get('date'))) and date < end and (parse_time(e.get('end_date')) or date)>=start), key=lambda e:(e['date'],e['id']))
        return {'events':ordered, 'sources':sources, 'window_start':start.isoformat(), 'window_end':end.isoformat(),
                'limited':len(profiles)>40, 'generated_at':datetime.now(timezone.utc).isoformat()}
