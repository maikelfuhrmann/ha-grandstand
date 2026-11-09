"""Optional explicitly shared HA calendars; personal agendas stay in Grandstand."""
from datetime import datetime, timezone
from hashlib import sha256

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from .agenda import calendar_span
from .personal import PERSONAL_KEY, PERSONAL_CHANGED


CALENDAR_WORDS={
 'en':('Time to be confirmed.','Calendar end is an estimated viewing block, not the actual result.'),
 'de':('Uhrzeit noch nicht bestätigt.','Das Kalenderende ist eine geschätzte Dauer, kein tatsächliches Spielergebnis.'),
 'es':('Hora pendiente de confirmar.','El final del calendario es una duración estimada, no el resultado real.'),
 'fr':("Horaire à confirmer.","La fin du calendrier est une durée estimée, pas le résultat réel."),
 'it':('Orario da confermare.','La fine del calendario è una durata stimata, non il risultato effettivo.'),
 'nl':('Tijd nog te bevestigen.','Het einde in de kalender is een geschatte duur, niet het werkelijke resultaat.'),
}


def calendar_event(event,zone,language='en'):
    span=calendar_span(event,zone)
    if not span:return None
    words=CALENDAR_WORDS.get(language,CALENDAR_WORDS['en'])
    return CalendarEvent(start=span[0],end=span[1],summary=event['name'],location=event.get('venue') or None,
        description=event['league']+' · Grandstand\n'+words[0 if not event.get('time_confirmed') else 1]+'\n/sports-hub',uid=event['id'])


async def async_setup_entry(hass,entry,async_add_entities):
    manager=hass.data[PERSONAL_KEY];added=set()
    @callback
    def discover(user_id=None):
        for key in manager.users:
            if key not in added and manager.snapshot(key)['settings']['calendar_shared']:
                added.add(key);async_add_entities([PersonalSportsCalendar(manager,key,entry.entry_id)],True)
    entry.async_on_unload(async_dispatcher_connect(hass,PERSONAL_CHANGED,discover))
    discover()


class PersonalSportsCalendar(CalendarEntity):
    _attr_icon='mdi:calendar-star'
    _attr_has_entity_name=False
    _attr_name='Grandstand'

    def __init__(self,manager,user_id,entry_id):
        self.manager=manager;self.user_id=user_id;self._event=None;self._signature=None
        self._attr_unique_id=entry_id+'_calendar_'+sha256(user_id.encode()).hexdigest()[:16]

    @property
    def shared(self):return self.manager.snapshot(self.user_id)['settings']['calendar_shared']

    @property
    def available(self):return self.shared

    @property
    def event(self):return self._event if self.shared else None

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        user=await self.hass.auth.async_get_user(self.user_id)
        self._attr_name='Grandstand · '+(user.name if user else 'Calendar')
        @callback
        def changed(user_id):
            if user_id==self.user_id:
                self._event=None
                self.async_write_ha_state()
                self.async_schedule_update_ha_state(True)
                self.async_update_event_listeners()
        self.async_on_remove(async_dispatcher_connect(self.hass,PERSONAL_CHANGED,changed))

    async def async_update(self):
        if not self.shared:self._event=None;return
        events=await self._events()
        signature=tuple((e.uid,e.start,e.end,e.summary,e.location,e.description) for e in events)
        if signature!=self._signature:
            self._signature=signature
            self.async_update_event_listeners()
        now=datetime.now(timezone.utc)
        self._event=next((e for e in events if e.end_datetime_local>now),None)

    async def _events(self):
        if not self.shared:return []
        user=await self.hass.auth.async_get_user(self.user_id)
        if not user or not user.is_active:return []
        data=await self.manager.feed(self.user_id)
        zone=dt_util.get_time_zone(self.hass.config.time_zone)
        return [e for raw in data['events'] if (e:=calendar_event(raw,zone,self.manager.snapshot(self.user_id)['settings']['language']))]

    async def async_get_events(self,hass,start_date,end_date):
        return [e for e in await self._events() if e.start_datetime_local<end_date and e.end_datetime_local>start_date]
