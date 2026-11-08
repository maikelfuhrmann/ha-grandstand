"""One setup flow creates the data source and entire dashboard."""
import probatio as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .catalog import DEFAULT_LEAGUES, LEAGUES, SPORTS, selected_leagues
from .const import CONF_DAYS_AHEAD, CONF_DAYS_BACK, CONF_LEAGUES, DEFAULT_DAYS_AHEAD, DEFAULT_DAYS_BACK, DOMAIN


def schema(values):
    return vol.Schema({
        vol.Required(CONF_LEAGUES, default=values.get(CONF_LEAGUES, DEFAULT_LEAGUES)): selector.SelectSelector(
            selector.SelectSelectorConfig(
                multiple=True, mode=selector.SelectSelectorMode.DROPDOWN,
                options=[selector.SelectOptionDict(value=key, label=f"{SPORTS[item['sport']][0]} · {item['name']}") for key, item in LEAGUES.items()],
            )
        ),
        vol.Required(CONF_DAYS_AHEAD, default=values.get(CONF_DAYS_AHEAD, DEFAULT_DAYS_AHEAD)): selector.NumberSelector(
            selector.NumberSelectorConfig(min=1, max=14, step=1, mode=selector.NumberSelectorMode.BOX)
        ),
        vol.Required(CONF_DAYS_BACK, default=values.get(CONF_DAYS_BACK, DEFAULT_DAYS_BACK)): selector.NumberSelector(
            selector.NumberSelectorConfig(min=1, max=7, step=1, mode=selector.NumberSelectorMode.BOX)
        ),
    })


def clean_input(values):
    return {
        CONF_LEAGUES: selected_leagues(values[CONF_LEAGUES]),
        CONF_DAYS_AHEAD: int(values[CONF_DAYS_AHEAD]),
        CONF_DAYS_BACK: int(values[CONF_DAYS_BACK]),
    }


class SportsHubConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors = {}
        if user_input is not None:
            data = clean_input(user_input)
            if data[CONF_LEAGUES]:
                return self.async_create_entry(title="Sports Hub", data=data)
            errors[CONF_LEAGUES] = "no_leagues"
        return self.async_show_form(step_id="user", data_schema=schema(user_input or {}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return SportsHubOptionsFlow()


class SportsHubOptionsFlow(config_entries.OptionsFlowWithReload):
    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            data = clean_input(user_input)
            if data[CONF_LEAGUES]:
                return self.async_create_entry(title="", data=data)
            errors[CONF_LEAGUES] = "no_leagues"
        return self.async_show_form(
            step_id="init", data_schema=schema(user_input or {**self.config_entry.data, **self.config_entry.options}), errors=errors
        )
