"""Authenticated on-demand dossiers for approved personal/shared dashboards."""
import probatio as vol
from homeassistant.components import websocket_api
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .match import websocket_match
from .const import DOMAIN
from .dashboards import DATA_KEY
from .enrichment import EnrichmentProvider, LANGUAGES

CONTEXT_KEY=f'{DOMAIN}_context'


def f1_bridge(hass):
    entries=[e for e in hass.config_entries.async_entries('f1_sensor') if e.state.value=='loaded']
    if not entries:return {'available':False}
    entry=entries[0]
    registry=er.async_get(hass)
    entities={}
    for item in er.async_entries_for_config_entry(registry,entry.entry_id):
        if item.disabled:continue
        for key in ('driver_positions','current_session','session_status','track_status'):
            if item.unique_id.endswith('_'+key):entities[key]=item.entity_id
    enabled={**entry.data,**entry.options}.get('install_dashboard_cards',True)
    return {'available':True,'entry_id':entry.entry_id,'cards_enabled':enabled,'module_url':'/local/f1-sensor-live-data-card/register.js','entities':entities}


def setup_context(hass):
    hass.data[CONTEXT_KEY]=EnrichmentProvider(async_get_clientsession(hass))
    websocket_api.async_register_command(hass,websocket_context)
    websocket_api.async_register_command(hass,websocket_match)


@websocket_api.websocket_command({'type':'sports_hub/context','key':str,vol.Optional('language',default='en'):str})
@websocket_api.async_response
async def websocket_context(hass,connection,msg):
    user=connection.user
    if user is None:
        connection.send_error(msg['id'],'unauthorized','Authentication required');return
    manager=hass.data[DATA_KEY]
    profile=manager.users.get(user.id,{}).get(msg['key']) or manager.shared.get(msg['key'])
    if not profile:
        connection.send_error(msg['id'],'not_found','Approved dashboard not found');return
    coordinators=hass.data.get(DOMAIN,{})
    if not coordinators:
        connection.send_error(msg['id'],'not_loaded','Sports Hub is not loaded');return
    snapshot=next(iter(coordinators.values())).data or {}
    language=msg['language'].lower().split('-')[0].split('_')[0]
    result=await hass.data[CONTEXT_KEY].context(profile,snapshot,language if language in LANGUAGES else 'en')
    if result.get('kind')=='f1':result['bridge']=f1_bridge(hass)
    connection.send_result(msg['id'],result)
