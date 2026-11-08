"""Sports Hub: automatically assembled sports dashboard for Home Assistant."""
from pathlib import Path

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import callback
from homeassistant.exceptions import ConfigEntryNotReady

from .catalog import SPORTS
from .const import DOMAIN, PANEL_NAME, PANEL_PATH, STATIC_PATH, VERSION
from .coordinator import SportsHubCoordinator
from .dashboards import DashboardManager, DATA_KEY, websocket_dashboards

PLATFORMS = [Platform.SENSOR]


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    await hass.http.async_register_static_paths([
        StaticPathConfig(STATIC_PATH, str(Path(__file__).parent / "frontend"), cache_headers=False)
    ])
    websocket_api.async_register_command(hass, websocket_data)
    manager = DashboardManager(hass)
    await manager.load()
    hass.data[DATA_KEY] = manager
    websocket_api.async_register_command(hass, websocket_dashboards)
    return True


async def async_setup_entry(hass, entry):
    if frontend.async_panel_exists(hass, PANEL_PATH):
        raise ConfigEntryNotReady("The /sports-hub URL is already in use. Rename the existing panel first.")
    coordinator = SportsHubCoordinator(hass, entry)
    # Partial source failures remain visible in the dashboard rather than preventing setup.
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    hass.data[DOMAIN][entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await panel_custom.async_register_panel(
        hass, frontend_url_path=PANEL_PATH, webcomponent_name=PANEL_NAME,
        sidebar_title="Sports Hub", sidebar_icon="mdi:scoreboard",
        module_url=f"{STATIC_PATH}/sports-hub.js?v={VERSION}",
        config={"entry_id": entry.entry_id, "version": VERSION},
        require_admin=False,
    )
    await hass.data[DATA_KEY].activate(entry.entry_id)
    return True


async def async_unload_entry(hass, entry):
    if unloaded := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DATA_KEY].unload()
        frontend.async_remove_panel(hass, PANEL_PATH)
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


@websocket_api.websocket_command({"type": "sports_hub/data"})
@callback
def websocket_data(hass, connection, msg):
    """Authenticated, read-only command. No tokens or settings leave HA."""
    coordinators = hass.data.get(DOMAIN, {})
    if not coordinators:
        connection.send_error(msg["id"], "not_loaded", "Sports Hub is not loaded")
        return
    coordinator = next(iter(coordinators.values()))
    connection.send_result(msg["id"], {
        **(coordinator.data or {}),
        "sports": [{"id": key, "name": names[0], "name_de": names[1], "icon": names[2]} for key, names in SPORTS.items()],
        "version": VERSION,
    })
