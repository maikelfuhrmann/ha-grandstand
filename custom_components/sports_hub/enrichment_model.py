"""Normalize rich club, competition and F1 data without exposing raw payloads."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import re
import math
from xml.etree import ElementTree

from .catalog import LEAGUES
from .model import normalize_scoreboard, normalize_competitor, safe_url, text, parse_time


def public_link(links, rel=None):
    return next((safe_url(x.get('href')) for x in links or [] if isinstance(x, dict) and (not rel or rel in x.get('rel', [])) and safe_url(x.get('href'))), '')


def numeric(value):
    try:
        n=float(value)
        if not math.isfinite(n):return None
        return int(n) if n.is_integer() else round(n, 3)
    except (ValueError, TypeError, OverflowError):
        return None


def stats_map(stats):
    return {text(x.get('name'), 60): {'value': numeric(x.get('value')), 'display': text(x.get('displayValue') or x.get('summary') or x.get('value'), 50)} for x in stats or [] if isinstance(x, dict) and x.get('name')}


def normalize_table(payload, league):
    groups=[]
    def walk(node):
        table=node.get('standings') or {}
        entries=[]
        for index, row in enumerate(table.get('entries', [])[:100]):
            team=normalize_competitor({'team': row.get('team', {})}, league['sport'])
            stats=stats_map(row.get('stats'))
            rank=stats.get('rank', {}).get('value') or stats.get('playoffSeed', {}).get('value') or index+1
            entries.append({'team':team, 'rank':rank, 'stats':stats, 'note':text((row.get('note') or {}).get('description'),120)})
        if entries:
            groups.append({'name':text(node.get('name') or table.get('seasonDisplayName') or league['name']), 'season':text(table.get('seasonDisplayName') or payload.get('season', {}).get('displayName')), 'entries':entries, 'url':public_link(table.get('links'))})
        for child in node.get('children', []):
            if isinstance(child,dict):walk(child)
    walk(payload)
    return {'league_id':league['id'], 'name':league['name'], 'groups':groups[:16]}


def normalize_schedule(payload, fallback, team_id=None):
    result={}
    for raw in payload.get('events', [])[:500]:
        league_info=raw.get('league') or next(iter(payload.get('leagues') or []),{})
        slug=league_info.get('slug')
        league=LEAGUES.get(f"{fallback['sport']}:{slug}") or ({**fallback,'id':f"{fallback['sport']}:{slug}",'path':slug,'name':text(league_info.get('shortName') or league_info.get('name'))} if isinstance(slug,str) and re.fullmatch(r'[a-z0-9._-]{1,80}',slug) else fallback)
        for event in normalize_scoreboard({'events':[raw]},league,datetime(2000,1,1,tzinfo=timezone.utc),datetime(2100,1,1,tzinfo=timezone.utc)):
            # Team schedules omit UIDs. Reconcile using provider team IDs at merge time.
            if team_id and not any(p['id']==team_id for p in event['participants']):continue
            season_type=raw.get('seasonType') or {}
            event.update({'season':text((raw.get('season') or {}).get('displayName') or (raw.get('season') or {}).get('slug'),100), 'round':text(season_type.get('name') if str(season_type.get('id')) not in ('1','2') else '',80), 'tournament':bool(league_info.get('isTournament')), 'stale':False})
            result[event['id']]=event
    return sorted(result.values(),key=lambda e:e['date'])


def normalize_team(payload):
    team=payload.get('team') or {}
    record=next((x for x in (team.get('record') or {}).get('items',[]) if x.get('type')=='total'),{})
    venue=team.get('venue') or team.get('franchise',{}).get('venue') or {}
    return {'id':text(team.get('id'),40),'name':text(team.get('displayName')), 'short_name':text(team.get('shortDisplayName')), 'record':text(record.get('summary'),60),'standing':text(team.get('standingSummary'),120),'stats':stats_map(record.get('stats')), 'venue':text(venue.get('fullName'),120), 'city':text((venue.get('address') or {}).get('city'),80), 'capacity':numeric(venue.get('capacity')), 'url':public_link(team.get('links'),'clubhouse'), 'league_slug':text((team.get('defaultLeague') or {}).get('slug') or team.get('leagueAbbrev'),80)}


def normalize_roster(payload):
    result=[]
    def add(raw):
        if 'items' in raw:
            for item in raw['items']:add(item)
            return
        if not raw.get('id') or not raw.get('displayName'):return
        position=raw.get('position') or {};flag=raw.get('flag') or {};country=raw.get('citizenshipCountry') or {}
        result.append({'id':text(raw['id'],40),'name':text(raw['displayName'],100),'number':text(raw.get('jersey'),8),'position':text(position.get('abbreviation') or position.get('displayName'),50),'position_name':text(position.get('displayName'),60),'age':numeric(raw.get('age')),'country':text(flag.get('alt') or country.get('displayName') or raw.get('citizenship'),60),'photo':safe_url((raw.get('headshot') or {}).get('href')),'url':public_link(raw.get('links'),'playercard')})
    for group in payload.get('athletes',[])[:100]:
        if isinstance(group,dict):add(group)
    return result[:100]


def normalize_news_xml(raw, now=None):
    # RSS never supplies executable markup to the frontend; only titles and HTTPS links.
    root=ElementTree.fromstring(raw)
    items=[];seen=set();now=now or datetime.now(timezone.utc)
    for item in root.findall('./channel/item')[:50]:
        title=text(item.findtext('title'),280);url=safe_url(item.findtext('link'));source=text(item.findtext('source'),80)
        try:published=parsedate_to_datetime(item.findtext('pubDate') or '').astimezone(timezone.utc)
        except (ValueError,TypeError,OverflowError):continue
        if not url or not title or title in seen or (now-published).days>30 or published>now:continue
        seen.add(title)
        if source and title.endswith(' - '+source):title=title[:-len(source)-3]
        items.append({'title':title,'url':url,'source':source,'published':published.isoformat()})
    return sorted(items,key=lambda x:x['published'],reverse=True)[:12]


def normalize_news_espn(payload, team_id=None):
    items=[]
    for a in payload.get('articles',[])[:30]:
        if team_id and not any(str(c.get('teamId'))==team_id for c in a.get('categories',[])):continue
        link=safe_url((a.get('links',{}).get('web') or {}).get('href'))
        if link and a.get('headline'):
            items.append({'title':text(a['headline'],280),'url':link,'source':'ESPN','published':text(a.get('published'),40)})
    return sorted(items,key=lambda x:x['published'],reverse=True)[:12]


def normalize_f1(calendar, drivers, constructors, results):
    def mr(data,key):return (data.get('MRData') or {}).get(key) or {}
    races=[]
    for r in mr(calendar,'RaceTable').get('Races',[])[:30]:
        sessions=[]
        for key,label in [('FirstPractice','FP1'),('SecondPractice','FP2'),('ThirdPractice','FP3'),('SprintQualifying','SQ'),('Sprint','Sprint'),('Qualifying','Qualifying')]:
            s=r.get(key)
            if s and s.get('date'):sessions.append({'name':label,'date':s['date']+'T'+s.get('time','00:00:00Z'),'time_confirmed':bool(s.get('time'))})
        sessions.append({'name':'Race','date':r['date']+'T'+r.get('time','00:00:00Z'),'time_confirmed':bool(r.get('time'))})
        c=r.get('Circuit') or {};location=c.get('Location') or {}
        races.append({'round':r.get('round'),'name':text(r.get('raceName')),'date':sessions[-1]['date'],'sessions':sorted(sessions,key=lambda x:x['date']),'circuit_id':text(c.get('circuitId')),'circuit':text(c.get('circuitName')),'locality':text(location.get('locality')),'country':text(location.get('country')),'url':safe_url(r.get('url'))})
    ds=[];cs=[]
    for table in mr(drivers,'StandingsTable').get('StandingsLists',[]):
        for row in table.get('DriverStandings',[]):
            d=row.get('Driver') or {};ds.append({'rank':row.get('position'),'name':text(d.get('givenName','')+' '+d.get('familyName','')),'code':text(d.get('code')),'points':row.get('points'),'wins':row.get('wins'),'team':', '.join(text(t.get('name')) for t in row.get('Constructors',[]))})
    for table in mr(constructors,'StandingsTable').get('StandingsLists',[]):
        for row in table.get('ConstructorStandings',[]):cs.append({'rank':row.get('position'),'name':text((row.get('Constructor') or {}).get('name')),'points':row.get('points'),'wins':row.get('wins')})
    last=[]
    for race in mr(results,'RaceTable').get('Races',[]):
        for row in race.get('Results',[]):
            d=row.get('Driver') or {};last.append({'rank':row.get('position'),'name':text(d.get('givenName','')+' '+d.get('familyName','')),'team':text((row.get('Constructor') or {}).get('name')),'points':row.get('points'),'laps':row.get('laps'),'time':text((row.get('Time') or {}).get('time') or row.get('status'))})
    rr=mr(results,'RaceTable').get('Races',[])
    return {'season':text(mr(calendar,'RaceTable').get('season')),'calendar':races,'drivers':ds,'constructors':cs,'results':last,'result_name':text(rr[0].get('raceName')) if rr else ''}
