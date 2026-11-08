"""Shared polling coordinator. Full scoreboards stay out of the recorder."""
from datetime import timedelta
import logging

from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .catalog import DEFAULT_LEAGUES, selected_leagues
from .const import CONF_DAYS_AHEAD, CONF_DAYS_BACK, CONF_LEAGUES, DEFAULT_DAYS_AHEAD, DEFAULT_DAYS_BACK, DOMAIN
from .provider import ScoreboardProvider

_LOGGER = logging.getLogger(__name__)


class SportsHubCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        settings = {**entry.data, **entry.options}
        self.provider = ScoreboardProvider(
            async_get_clientsession(hass),
            selected_leagues(settings.get(CONF_LEAGUES, DEFAULT_LEAGUES)),
            settings.get(CONF_DAYS_BACK, DEFAULT_DAYS_BACK),
            settings.get(CONF_DAYS_AHEAD, DEFAULT_DAYS_AHEAD),
            dt_util.get_time_zone(hass.config.time_zone),
        )
        super().__init__(hass, _LOGGER, name=DOMAIN, config_entry=entry, update_interval=timedelta(seconds=30))

    async def _async_update_data(self):
        return await self.provider.update()
