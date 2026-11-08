"""Public match facts: event timeline, published lineups and box scores."""
from datetime import datetime, timedelta, timezone
import re

import probatio as vol
from homeassistant.components import websocket_api

from .catalog import LEAGUES
from .const import API_ROOT, DOMAIN
from .enrichment_model import numeric, public_link
from .model import normalize_competitor, normalize_scoreboard, parse_time, safe_url, text


def normalize_match(payload, league, event_id):
    header=payload.get('header') or {};competitions=header.get('competitions') or []
    comp=next((c for c in competitions if str(c.get('id'))==event_id),next(iter(competitions),{}))
    state={'pre':'scheduled','in':'live','post':'finished'}.get((comp.get('status') or {}).get('type',{}).get('state'),'unknown')
    # This normalizer retains only match facts, never betting odds or article bodies.
    teams=[];players={};lineups=[];player_tables=[]
    box=payload.get('boxscore') or {}
    for group in box.get('teams',[])[:2]:
        team=normalize_competitor({'team':group.get('team',{}),'homeAway':group.get('homeAway')},league['sport'])
        stats=[]
        for stat in group.get('statistics',[])[:60]:
            key=text(stat.get('name'),80);display=text(stat.get('displayValue'),60)
            value=numeric(display.replace('%',''))
            if league['sport']=='soccer' and key.endswith('Pct') and key!='possessionPct' and value is not None and 0<=value<=1:
                value=round(value*100,1);display=f'{value:g}%'
            elif key.endswith('Pct') and value is not None:display=display.rstrip('%')+'%'
            stats.append({'key':key,'label':text(stat.get('label') or stat.get('abbreviation') or key,100),'display':display,'value':value})
        teams.append({'team':team,'stats':stats})
    def athlete(raw):
        a=raw.get('athlete') or {};pos=raw.get('position') or a.get('position') or {}
        p={'id':text(a.get('id'),40),'name':text(a.get('displayName') or a.get('fullName'),100),'number':text(raw.get('jersey') or a.get('jersey'),8),'position':text(pos.get('abbreviation'),20),'starter':raw.get('starter') is True,'in':raw.get('subbedIn') is True,'out':raw.get('subbedOut') is True,'photo':safe_url((a.get('headshot') or {}).get('href'))}
        if p['id']:players[p['id']]=p
        return p
    for group in payload.get('rosters',[])[:2]:
        team=normalize_competitor({'team':group.get('team',{}),'homeAway':group.get('homeAway')},league['sport'])
        roster=[athlete(p) for p in group.get('roster',[])[:60]]
        lineups.append({'team':team,'formation':text(group.get('formation'),30),'players':roster,'has_starters':any(p['starter'] for p in roster)})
        if state!='scheduled':
            keys=['totalGoals','goalAssists','shotsTotal','shotsOnTarget','foulsCommitted','yellowCards','redCards']
            raw_stats={str(p.get('athlete',{}).get('id')):{s.get('name'):text(s.get('displayValue'),40) for s in p.get('stats',[])} for p in group.get('roster',[])[:60]}
            columns=[k for k in keys if any(k in stats for stats in raw_stats.values())]
            if columns:player_tables.append({'team':team,'name':'','keys':columns,'labels':columns,'players':[{'name':p['name'],'starter':p['starter'],'values':[raw_stats[p['id']].get(k,'–') for k in columns]} for p in roster if p['id'] in raw_stats]})
    for group in box.get('players',[])[:2]:
        team=normalize_competitor({'team':group.get('team',{})},league['sport']);unique={};has_starter_field=False
        for category in group.get('statistics',[])[:12]:
            rows=[]
            for raw in category.get('athletes',[])[:60]:
                p=athlete(raw);unique[p['id']]=p;has_starter_field|='starter' in raw
                rows.append({'name':p['name'],'starter':p['starter'],'values':[text(v,40) for v in raw.get('stats',[])[:24]]})
            if rows and state!='scheduled':player_tables.append({'team':team,'name':text(category.get('text') or category.get('name'),100),'keys':[text(k,80) for k in category.get('keys',[])[:24]],'labels':[text(k,30) for k in category.get('labels',[])[:24]],'players':rows})
        if not any(l['team']['id']==team['id'] for l in lineups):lineups.append({'team':team,'formation':'','players':list(unique.values()),'has_starters':has_starter_field and any(p['starter'] for p in unique.values())})
    timeline=[];seen=set()
    drives=payload.get('drives') or {}
    drive_plays=[p for drive in (drives.get('previous') or [])[-60:] for p in (drive.get('plays') or [])]+((drives.get('current') or {}).get('plays') or [])
    raw_plays=payload.get('keyEvents') or payload.get('plays') or drive_plays or payload.get('scoringPlays') or []
    for index,play in enumerate(raw_plays[-500:]):
        id=text(play.get('id') or index,80)
        if id in seen:continue
        seen.add(id);kind=play.get('type') or {};participants=[]
        for raw in play.get('participants',[])[:4]:
            a=raw.get('athlete') or {};name=text(a.get('displayName') or players.get(str(a.get('id')),{}).get('name'),100)
            if name:participants.append(name)
        timeline.append({'id':id,'kind':text(kind.get('type') or kind.get('abbreviation') or kind.get('text'),80),'label':text(kind.get('text'),120),'clock':text((play.get('clock') or {}).get('displayValue'),30),'period':text((play.get('period') or {}).get('number'),10),'team_id':text((play.get('team') or {}).get('id'),40),'participants':participants,'scoring':play.get('scoringPlay') is True,'home_score':numeric(play.get('homeScore')),'away_score':numeric(play.get('awayScore')),'time':text(play.get('wallclock'),40),'order':numeric(play.get('sequenceNumber')) or index})
    timeline.sort(key=lambda p:(p['time'] or '',p['order']),reverse=True)
    info=payload.get('gameInfo') or {};venue=info.get('venue') or {}
    event_raw={**header,'id':event_id,'date':comp.get('date') or header.get('date'),'competitions':[comp]}
    normalized=normalize_scoreboard({'events':[event_raw]},league,datetime(2000,1,1,tzinfo=timezone.utc),datetime(2100,1,1,tzinfo=timezone.utc)) if comp else []
    return {'event_id':event_id,'state':state,'event':normalized[0] if normalized else None,'teams':sorted(teams,key=lambda t:t['team']['home_away']!='home'),'lineups':sorted(lineups,key=lambda l:l['team']['home_away']!='home'),'player_tables':player_tables,'timeline':timeline[:200],'timeline_kind':'key_events' if payload.get('keyEvents') else 'scoring' if not payload.get('plays') and not drive_plays and payload.get('scoringPlays') else 'plays','stats_scope':'season' if state=='scheduled' else 'match','venue':text(venue.get('fullName'),120),'city':text((venue.get('address') or {}).get('city'),80),'attendance':numeric(info.get('attendance')),'officials':[text(o.get('displayName') or o.get('fullName'),100) for o in info.get('officials',[])[:8]],'url':public_link(header.get('links'))}


@websocket_api.websocket_command({'type':'sports_hub/match','league_id':str,'event_id':str})
@websocket_api.async_response
async def websocket_match(hass,connection,msg):
    if connection.user is None:connection.send_error(msg['id'],'unauthorized','Authentication required');return
    league=LEAGUES.get(msg['league_id']);event_id=msg['event_id']
    if not league or not re.fullmatch(r'[0-9]{1,20}',event_id):connection.send_error(msg['id'],'invalid_event','Invalid competition or event');return
    if not hass.data.get(DOMAIN):connection.send_error(msg['id'],'not_loaded','Sports Hub is not loaded');return
    provider=hass.data[f'{DOMAIN}_context']
    url=f"{API_ROOT}/{league['sport']}/{league['path']}/summary?event={event_id}"
    cached=provider.cache.get(url)
    if cached and not cached['error']:
        old_comp=next(iter((cached['data'].get('header') or {}).get('competitions') or []),{})
        old_start=parse_time(old_comp.get('date'));retrieved=parse_time(cached['updated_at']);now=datetime.now(timezone.utc)
        if old_start and retrieved and abs((now-old_start).total_seconds())<5400 and (now-retrieved).total_seconds()>30:cached['expires']=now
    item=await provider.get(url,30)
    result=normalize_match(item['data'],league,event_id)
    now=datetime.now(timezone.utc);start=parse_time((result.get('event') or {}).get('date'))
    near_start=start and abs((now-start).total_seconds())<5400
    if not item['error'] and result['state']!='live' and not near_start:item['expires']=(parse_time(item['updated_at']) or now)+timedelta(minutes=15)
    result.update(updated_at=item['updated_at'],stale=item['error'])
    if result['event']:result['event'].update(updated_at=item['updated_at'],stale=item['error'])
    connection.send_result(msg['id'],result)
