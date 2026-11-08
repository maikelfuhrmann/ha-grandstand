"""User-approved personal dashboards and optional administrator-published panels."""
import asyncio
from copy import deepcopy
from hashlib import sha256

import probatio as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.helpers.storage import Store

from .catalog import SPORTS
from .catalog import LEAGUES
from .const import DOMAIN, PANEL_NAME, STATIC_PATH, VERSION
from .model import safe_color, safe_url, text

DATA_KEY = f"{DOMAIN}_dashboards"
MAX_DASHBOARDS = 40


def clean_dashboard(value):
    """Validate persisted/user-supplied display metadata and bounded identifiers."""
    if not isinstance(value, dict) or value.get("kind") not in ("team", "league"):
        raise ValueError("invalid_dashboard")
    kind, target = value["kind"], value.get("target")
    if not isinstance(target, str) or not target or len(target) > 240:
        raise ValueError("invalid_dashboard")
    sport = value.get("sport")
    if sport not in SPORTS:
        raise ValueError("invalid_dashboard")
    name = text(value.get("name"), 100).strip()
    if not name:
        raise ValueError("invalid_dashboard")
    return {
        "key": f"{kind}:{target}", "kind": kind, "target": target,
        "name": name, "sport": sport, "logo": safe_url(value.get("logo")),
        "color": safe_color(value.get("color")) or "#315bd6",
        "alternate_color": safe_color(value.get("alternate_color")) or "#ffffff",
        "league_id": value.get("league_id") if value.get("league_id") in LEAGUES else None,
    }


class DashboardManager:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, f"{DOMAIN}.dashboards")
        self.users = {}
        self.shared = {}
        self.registered = set()
        self.entry_id = None
        self.lock = asyncio.Lock()

    async def load(self):
        saved = await self.store.async_load() or {}
        self.users = saved.get("users", {})
        self.shared = saved.get("shared", {})

    async def persist(self):
        await self.store.async_save({"users": self.users, "shared": self.shared})

    def snapshot(self, user_id):
        return {"dashboards": deepcopy(list(self.users.get(user_id, {}).values())),
                "sidebar": deepcopy(list(self.shared.values()))}

    async def save(self, user_id, value, confirmed):
        if confirmed is not True:
            raise ValueError("confirmation_required")
        dashboard = clean_dashboard(value)
        async with self.lock:
            current = self.users.get(user_id, {})
            if dashboard["key"] not in current and len(current) >= MAX_DASHBOARDS:
                raise ValueError("dashboard_limit")
            before = deepcopy(self.users)
            self.users.setdefault(user_id, {})[dashboard["key"]] = dashboard
            try:
                await self.persist()
            except Exception:
                self.users = before
                raise
        return self.snapshot(user_id)

    async def remove(self, user_id, key):
        async with self.lock:
            before = deepcopy(self.users)
            self.users.get(user_id, {}).pop(key, None)
            try:
                await self.persist()
            except Exception:
                self.users = before
                raise
        return self.snapshot(user_id)

    async def register(self, dashboard):
        path = dashboard["path"]
        if path in self.registered:
            frontend.async_remove_panel(self.hass, path)
            self.registered.discard(path)
        elif frontend.async_panel_exists(self.hass, path):
            raise ValueError("panel_path_in_use")
        await panel_custom.async_register_panel(
            self.hass, frontend_url_path=path, webcomponent_name=PANEL_NAME,
            sidebar_title=dashboard["name"], sidebar_icon=SPORTS[dashboard["sport"]][2],
            module_url=f"{STATIC_PATH}/sports-hub.js?v={VERSION}",
            config={"entry_id": self.entry_id, "version": VERSION, "dashboard": dashboard},
            require_admin=False,
        )
        self.registered.add(path)

    async def activate(self, entry_id):
        self.entry_id = entry_id
        for dashboard in self.shared.values():
            try:
                await self.register(dashboard)
            except ValueError:
                # Never replace a panel belonging to another integration.
                continue

    def unload(self):
        for path in self.registered:
            frontend.async_remove_panel(self.hass, path)
        self.registered.clear()
        self.entry_id = None

    async def publish(self, user_id, key, confirmed, is_admin):
        if not is_admin:
            raise ValueError("admin_required")
        if confirmed is not True:
            raise ValueError("confirmation_required")
        async with self.lock:
            profile = self.users.get(user_id, {}).get(key)
            if not profile:
                raise ValueError("approve_first")
            if not self.entry_id:
                raise ValueError("not_loaded")
            if key not in self.shared and len(self.shared) >= MAX_DASHBOARDS:
                raise ValueError("dashboard_limit")
            dashboard = {**profile, "path": "sports-hub-" + sha256(key.encode()).hexdigest()[:16]}
            old = self.shared.get(key)
            await self.register(dashboard)
            self.shared[key] = dashboard
            try:
                await self.persist()
            except Exception:
                frontend.async_remove_panel(self.hass, dashboard["path"])
                self.registered.discard(dashboard["path"])
                if old:
                    self.shared[key] = old
                    await self.register(old)
                else:
                    self.shared.pop(key, None)
                raise
        return self.snapshot(user_id)

    async def unpublish(self, key, is_admin):
        if not is_admin:
            raise ValueError("admin_required")
        async with self.lock:
            old = self.shared.pop(key, None)
            try:
                await self.persist()
            except Exception:
                if old:
                    self.shared[key] = old
                raise
            if old and old["path"] in self.registered:
                frontend.async_remove_panel(self.hass, old["path"])
                self.registered.discard(old["path"])


@websocket_api.websocket_command({
    "type": "sports_hub/dashboards",
    vol.Optional("action", default="list"): vol.In(["list", "save", "remove", "publish", "unpublish"]),
    vol.Optional("dashboard"): dict,
    vol.Optional("key"): str,
    vol.Optional("confirmed", default=False): bool,
})
@websocket_api.async_response
async def websocket_dashboards(hass, connection, msg):
    manager = hass.data[DATA_KEY]
    user = connection.user
    if user is None:
        connection.send_error(msg["id"], "unauthorized", "Authentication required")
        return
    action = msg.get("action", "list")
    if action in ("publish", "unpublish") and not user.is_admin:
        connection.send_error(msg["id"], "admin_required", "Only administrators can change shared sidebar panels")
        return
    try:
        if action == "save":
            await manager.save(user.id, msg.get("dashboard"), msg.get("confirmed"))
        elif action == "remove":
            await manager.remove(user.id, msg.get("key"))
        elif action == "publish":
            await manager.publish(user.id, msg.get("key"), msg.get("confirmed"), user.is_admin)
        elif action == "unpublish":
            await manager.unpublish(msg.get("key"), user.is_admin)
    except ValueError as err:
        connection.send_error(msg["id"], str(err), str(err))
        return
    connection.send_result(msg["id"], manager.snapshot(user.id))
