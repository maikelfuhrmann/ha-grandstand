"""Opt-in pre-start reminders to a user's own Companion App device."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import logging

from homeassistant.core import Context
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .model import parse_time

_LOGGER=logging.getLogger(__name__)
REMINDER_WORDS={
 'en':('Starts in {minutes} minutes','Open Grandstand'),
 'de':('Beginnt in {minutes} Minuten','Grandstand öffnen'),
 'es':('Empieza en {minutes} minutos','Abrir Grandstand'),
 'fr':('Commence dans {minutes} minutes','Ouvrir Grandstand'),
 'it':('Inizia tra {minutes} minuti','Apri Grandstand'),
 'nl':('Begint over {minutes} minuten','Grandstand openen'),
}


def quiet_now(settings,now,zone):
    if not settings['quiet_enabled']:return False
    clock=now.astimezone(zone).strftime('%H:%M');start=settings['quiet_start'];end=settings['quiet_end']
    if start==end:return False
    return start<=clock<end if start<end else clock>=start or clock<end


def reminder_key(user_id,event,minutes):
    return sha256(f"{user_id}:{event['id']}:{event['date']}:{minutes}".encode()).hexdigest()


def due_reminders(events,settings,sent,user_id,now,zone):
    if not settings['reminders_enabled'] or quiet_now(settings,now,zone):return []
    result=[];minutes=settings['reminder_minutes']
    for event in events:
        start=parse_time(event.get('date'));updated=parse_time(event.get('updated_at'))
        if not start or not updated or event.get('state')!='scheduled' or not event.get('time_confirmed') or event.get('stale'):continue
        if now-updated>timedelta(hours=2) or updated>now+timedelta(minutes=5):continue
        due=start-timedelta(minutes=minutes)
        if not due<=now<min(start,due+timedelta(seconds=90)):continue
        key=reminder_key(user_id,event,minutes)
        if key not in sent:result.append((key,event))
    return result[:5]


class ReminderRunner:
    def __init__(self,manager):
        self.manager=manager;self.hass=manager.hass;self.busy=False

    async def tick(self,now):
        if self.busy:return
        self.busy=True
        try:
            zone=dt_util.get_time_zone(self.hass.config.time_zone)
            for user_id in list(self.manager.users):
                user=await self.hass.auth.async_get_user(user_id)
                if not user or not user.is_active:continue
                prefs=self.manager.snapshot(user_id);settings=prefs['settings']
                if not settings['reminders_enabled']:continue
                service=self.manager.notification_service(user_id,settings['reminder_device'])
                if not service:continue
                try:
                    feed=await self.manager.feed(user_id)
                    # Fetching schedules can take time: honor opt-out/device changes immediately.
                    current=self.manager.snapshot(user_id)
                    if current['revision']!=prefs['revision']:continue
                    settings=current['settings']
                    service=self.manager.notification_service(user_id,settings['reminder_device'])
                    if not settings['reminders_enabled'] or not service:continue
                    for key,event in due_reminders(feed['events'],settings,self.manager.sent,user_id,now,zone):
                        # Save before sending so a restart cannot duplicate this reminder.
                        async with self.manager.lock:
                            if key in self.manager.sent or self.manager.snapshot(user_id)!=current:continue
                            before=dict(self.manager.sent)
                            cutoff=now-timedelta(days=100)
                            self.manager.sent={k:v for k,v in self.manager.sent.items() if (parse_time(v) or now)>cutoff}
                            self.manager.sent[key]=now.isoformat()
                            try:await self.manager.persist()
                            except OSError:
                                self.manager.sent=before;raise
                        if self.manager.snapshot(user_id)!=current or self.manager.notification_service(user_id,settings['reminder_device'])!=service:continue
                        words=REMINDER_WORDS.get(settings['language'],REMINDER_WORDS['en'])
                        message=event['name']+'\n'+words[0].format(minutes=settings['reminder_minutes'])
                        await self.hass.services.async_call('notify',service,{'title':'Grandstand','message':message,
                            'data':{'tag':'grandstand-'+key[:20],'url':'/sports-hub','clickAction':'/sports-hub',
                                    'actions':[{'action':'URI','title':words[1],'uri':'/sports-hub'}]}},blocking=True,context=Context(user_id=user_id))
                except Exception:
                    # No device IDs, private favorites or push payloads in the log.
                    _LOGGER.warning('Grandstand could not deliver a reminder; check Companion App availability')
        finally:self.busy=False

    def start(self):
        return async_track_time_interval(self.hass,self.tick,timedelta(seconds=30))
