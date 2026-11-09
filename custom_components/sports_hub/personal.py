"""Server-side preferences owned by the authenticated HA user."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import re

import probatio as vol
from homeassistant.components import websocket_api
from homeassistant.helpers.storage import Store
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .agenda import AgendaProvider
from .catalog import LEAGUES
from .const import DOMAIN
from .context import CONTEXT_KEY
from .dashboards import DATA_KEY as DASHBOARDS_KEY, clean_dashboard

PERSONAL_KEY = DOMAIN+'_personal'
PERSONAL_CHANGED = DOMAIN+'_personal_changed'
DEFAULTS = {'hide_scores':False, 'start_view':'myday', 'grid_visual':'portraits', 'language':'en',
            'calendar_shared':False, 'reminders_enabled':False, 'reminder_minutes':15, 'reminder_device':'',
            'quiet_enabled':True, 'quiet_start':'22:00', 'quiet_end':'08:00'}


def clean_settings(values):
    if not isinstance(values, dict) or set(values)-set(DEFAULTS):
        raise ValueError('invalid_preferences')
    result={}
    for key,value in values.items():
        if key in ('hide_scores','calendar_shared','reminders_enabled','quiet_enabled'):
            if not isinstance(value,bool):raise ValueError('invalid_preferences')
        elif key=='reminder_minutes':
            if type(value) is not int or value not in (5,10,15,30,60):raise ValueError('invalid_preferences')
        elif key in ('quiet_start','quiet_end'):
            if not isinstance(value,str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',value):raise ValueError('invalid_preferences')
        elif key=='start_view' and value not in ('myday','home'):raise ValueError('invalid_preferences')
        elif key=='grid_visual' and value not in ('portraits','cars','drivers'):raise ValueError('invalid_preferences')
        elif key=='language' and value not in ('de','en','es','fr','it','nl'):raise ValueError('invalid_preferences')
        elif key=='reminder_device' and (not isinstance(value,str) or len(value)>100):raise ValueError('invalid_preferences')
        result[key]=value
    return result


def favorite_key(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-zA-Z0-9_:~.\-]{1,240}',value):
        raise ValueError('invalid_favorite')
    return value


class PersonalManager:
    def __init__(self,hass):
        self.hass=hass;self.store=Store(hass,1,DOMAIN+'.personal');self.users={};self.sent={}
        self.lock=asyncio.Lock();self.agenda_cache={};self.agenda_pending={}
        self.agenda=AgendaProvider(hass.data[CONTEXT_KEY])

    async def load(self):
        saved=await self.store.async_load() or {}
        self.users=saved.get('users',{});self.sent=saved.get('sent',{})

    async def persist(self):
        await self.store.async_save({'users':self.users,'sent':self.sent})

    def snapshot(self,user_id):
        row=deepcopy(self.users.get(user_id,{}))
        return {'initialized':user_id in self.users,'revision':row.get('revision',0),
                'favorites':row.get('favorites',{}),'settings':{**DEFAULTS,**row.get('settings',{})}}

    def devices(self,user_id):
        """Expose only owned device labels/entry IDs; webhook IDs never leave the server."""
        service=self.hass.data.get('mobile_app',{}).get('notify')
        registered=getattr(service,'registered_targets',{})
        return [{'id':e.entry_id,'name':e.title} for e in self.hass.config_entries.async_entries('mobile_app')
                if e.data.get('user_id')==user_id and e.data.get('webhook_id') in registered.values()]

    def notification_service(self,user_id,device_id):
        entry=next((e for e in self.hass.config_entries.async_entries('mobile_app') if e.entry_id==device_id and e.data.get('user_id')==user_id),None)
        registered=getattr(self.hass.data.get('mobile_app',{}).get('notify'),'registered_targets',{})
        if not entry:return None
        return next((name for name,target in registered.items() if target==entry.data.get('webhook_id') and self.hass.services.has_service('notify',name)),None)

    def known_profiles(self,user_id,snapshot):
        profiles={}
        for p in self.hass.data[DASHBOARDS_KEY].users.get(user_id,{}).values():
            profiles[p['key'] if p['kind']=='league' else p['target']]=p
        for league in snapshot.get('leagues',[]):
            if league['id'] in LEAGUES:
                p={**league,'kind':'league','target':league['id'],'league_id':league['id']}
                profiles['league:'+league['id']]=clean_dashboard(p)
        for event in snapshot.get('events',[]):
            for p in event.get('participants',[]):
                if p.get('key'):
                    profiles[p['key']]=clean_dashboard({**p,'kind':'team','target':p['key'],'sport':event['sport'],'league_id':event['league_id']})
        return profiles

    async def update(self,user_id,action,payload,is_admin=False):
        async with self.lock:
            before=deepcopy(self.users)
            row=self.users.setdefault(user_id,{'revision':0,'favorites':{},'settings':dict(DEFAULTS)})
            try:
                if action=='initialize' and user_id not in before:
                    # First device imports old browser favorites; approved personal dashboards seed new devices.
                    snapshot=self.scoreboard();known=self.known_profiles(user_id,snapshot)
                    legacy=payload.get('legacy') or {}
                    keys=legacy.get('favorites',list(self.hass.data[DASHBOARDS_KEY].users.get(user_id,{})))
                    if not isinstance(keys,list) or not isinstance(legacy.get('names',{}),dict):raise ValueError('invalid_favorite')
                    for key in keys[:200]:
                        key=key[5:] if key.startswith('team:') else key
                        key=favorite_key(key);p=known.get(key)
                        row['favorites'][key]={'name':(p or {}).get('name') or str((legacy.get('names') or {}).get(key,key))[:100],'profile':p}
                    row['settings']['hide_scores']=legacy.get('hideScores') is True
                elif action=='favorite':
                    key=favorite_key(payload.get('key'))
                    if payload.get('enabled') is True:
                        if key not in row['favorites'] and len(row['favorites'])>=200:raise ValueError('favorite_limit')
                        p=payload.get('profile') or self.known_profiles(user_id,self.scoreboard()).get(key)
                        p=clean_dashboard(p) if p else None
                        if p and (p['key'] if p['kind']=='league' else p['target'])!=key:raise ValueError('invalid_favorite')
                        row['favorites'][key]={'name':p['name'] if p else str(payload.get('name') or key)[:100],'profile':p}
                    elif payload.get('enabled') is False:row['favorites'].pop(key,None)
                    else:raise ValueError('invalid_favorite')
                elif action=='settings':
                    changes=clean_settings(payload.get('settings',{}))
                    if changes.get('calendar_shared') and not row['settings']['calendar_shared'] and not is_admin:raise ValueError('admin_required')
                    settings={**row['settings'],**changes}
                    if settings['reminders_enabled'] and settings['reminder_device'] not in {d['id'] for d in self.devices(user_id)}:raise ValueError('device_required')
                    row['settings']=settings
                elif action!='initialize':raise ValueError('invalid_action')
                row['revision']+=1
                await self.persist()
            except Exception:
                self.users=before;raise
        self.agenda_cache.pop(user_id,None)
        async_dispatcher_send(self.hass,PERSONAL_CHANGED,user_id)
        return self.snapshot(user_id)

    def scoreboard(self):
        coordinators=self.hass.data.get(DOMAIN,{})
        return next(iter(coordinators.values())).data or {} if coordinators else {}

    async def feed(self,user_id,news=False):
        prefs=self.snapshot(user_id);favorites=prefs['favorites'];now=datetime.now(timezone.utc)
        snapshot=self.scoreboard();known=self.known_profiles(user_id,snapshot)
        profiles=[value.get('profile') or known.get(key) for key,value in favorites.items()]
        profiles=[p for p in profiles if p]
        cached=self.agenda_cache.get(user_id)
        if not cached or cached['revision']!=prefs['revision'] or cached['expires']<=now:
            key=(user_id,prefs['revision'])
            if key not in self.agenda_pending:
                async def fetch():
                    return await self.agenda.events(profiles,snapshot,favorites,now-timedelta(days=7),now+timedelta(days=90))
                self.agenda_pending[key]=asyncio.create_task(fetch())
            task=self.agenda_pending[key]
            try:data=await asyncio.shield(task)
            finally:
                if task.done():self.agenda_pending.pop(key,None)
            cached={'revision':prefs['revision'],'expires':now+timedelta(seconds=60),'data':data}
            self.agenda_cache[user_id]=cached
        result=deepcopy(cached['data'])
        # Overlay the current shared scoreboard without fetching a season every 30 seconds.
        from .agenda import follows
        merged={e['id']:e for e in result['events']}
        for event in snapshot.get('events',[]):
            if follows(event,favorites):
                if event['league_id']=='racing:f1':
                    from .model import parse_time
                    start=parse_time(event['date'])
                    merged={k:e for k,e in merged.items() if not (e.get('calendar_only') and start and abs((parse_time(e['date'])-start).total_seconds())<120)}
                merged[event['id']]=event
        result['events']=sorted(merged.values(),key=lambda e:(e['date'],e['id']))
        result['profiles']=profiles;result['news']=[]
        if news and not prefs['settings']['hide_scores']:
            for p in profiles[:3]:
                league,team=self.hass.data[CONTEXT_KEY].resolve(p,snapshot)
                if not league:continue
                articles=await self.hass.data[CONTEXT_KEY].news(p['name'],prefs['settings']['language'],league,team)
                result['news'].extend({**a,'followed_name':p['name']} for a in articles['articles'][:2])
        return result


@websocket_api.websocket_command({'type':'sports_hub/personal',vol.Optional('action',default='get'):vol.In(['get','initialize','favorite','settings','feed']),vol.Optional('legacy'):dict,vol.Optional('key'):str,vol.Optional('enabled'):bool,vol.Optional('profile'):dict,vol.Optional('name'):str,vol.Optional('settings'):dict})
@websocket_api.async_response
async def websocket_personal(hass,connection,msg):
    user=connection.user
    if user is None:
        connection.send_error(msg['id'],'unauthorized','Authentication required');return
    manager=hass.data[PERSONAL_KEY];action=msg.get('action','get')
    try:
        if action=='feed':result=await manager.feed(user.id,news=True)
        else:
            if action!='get':await manager.update(user.id,action,msg,user.is_admin)
            result={**manager.snapshot(user.id),'devices':manager.devices(user.id)}
        connection.send_result(msg['id'],result)
    except (ValueError,OSError) as err:
        code=str(err) if isinstance(err,ValueError) else 'save_failed'
        connection.send_error(msg['id'],code,code)
