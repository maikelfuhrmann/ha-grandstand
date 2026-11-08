"""Boot an isolated real HA runtime and verify setup, panel, entities, and unload.

Uses a temporary config and mock upstream scoreboards; never connects to a user's HA.
"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from homeassistant.bootstrap import async_from_config_dict
from homeassistant.core import HomeAssistant
from homeassistant import loader
from homeassistant.components import frontend
from homeassistant.runner import configure_event_loop

async def main():
    configure_event_loop(asyncio.get_running_loop())
    with tempfile.TemporaryDirectory(prefix='sports-hub-ha-') as directory:
        (Path(directory)/'custom_components').symlink_to(ROOT/'custom_components',target_is_directory=True)
        hass=HomeAssistant(directory)
        loader.async_setup(hass)
        try:
            result=await async_from_config_dict({'homeassistant':{'name':'Sports Hub Test','time_zone':'Europe/Berlin','country':'DE'},'http':{'server_host':'127.0.0.1','server_port':18123},'frontend':{}},hass)
            assert result is not None,'Home Assistant failed to initialize'
            from custom_components.sports_hub.provider import ScoreboardProvider
            async def empty_update(self,now=None):return self.snapshot()
            with patch.object(ScoreboardProvider,'update',empty_update):
                flow=await hass.config_entries.flow.async_init('sports_hub',context={'source':'user'})
                assert flow['type']=='form',flow
                created=await hass.config_entries.flow.async_configure(flow['flow_id'],{'leagues':['soccer:ger.1','basketball:nba'],'days_ahead':7,'days_back':2})
                assert created['type']=='create_entry',created
                entry=created['result']
                await hass.async_block_till_done()
                assert frontend.async_panel_exists(hass,'sports-hub'),'Panel missing'
                assert len(hass.states.async_all('sensor'))==4,[s.entity_id for s in hass.states.async_all()]
                print('PASS: config flow, automatic dashboard registration, four summary sensors',flush=True)
                assert await hass.config_entries.async_unload(entry.entry_id)
                assert not frontend.async_panel_exists(hass,'sports-hub')
                assert await hass.config_entries.async_setup(entry.entry_id)
                assert frontend.async_panel_exists(hass,'sports-hub')
                print('PASS: unload and reload without duplicate panels/resources',flush=True)
        finally:
            await hass.async_stop(force=True)

if __name__=='__main__':asyncio.run(main())
