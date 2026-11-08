"""Small automation-friendly summary sensors; no scoreboards in state attributes."""
from datetime import datetime, timezone

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION
from .model import parse_time


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([SportsHubSensor(entry.runtime_data, entry, key) for key in ("live_events", "scheduled_events", "leagues", "source_errors")])


class SportsHubSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_icon = "mdi:scoreboard"

    def __init__(self, coordinator, entry, key):
        super().__init__(coordinator)
        self.key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)}, "name": "Sports Hub",
            "manufacturer": "Sports Hub", "model": "Multi-sport dashboard", "sw_version": VERSION,
        }

    @property
    def native_value(self):
        data = self.coordinator.data or {}
        if self.key == "leagues":
            return len(data.get("leagues", []))
        if self.key == "source_errors":
            return sum(bool(league.get("error")) for league in data.get("leagues", []))
        if self.key == "live_events":
            return sum(event["state"] == "live" and not event.get("stale") for event in data.get("events", []))
        now = datetime.now(timezone.utc)
        return sum(event["state"] == "scheduled" and (parse_time(event["date"]) or now) >= now for event in data.get("events", []))
