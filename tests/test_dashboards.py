"""Approval, ownership, sidebar permissions and persistence failure behavior."""
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from custom_components.sports_hub.dashboards import DashboardManager, clean_dashboard, websocket_dashboards, DATA_KEY

PROFILE={'kind':'team','target':'soccer:s:600~t:132','sport':'soccer','name':'Bayern Munich','logo':'https://a.espncdn.com/i/teamlogos/soccer/500/132.png','color':'dc052d','alternate_color':'ffffff'}

class DashboardTests(unittest.IsolatedAsyncioTestCase):
    def manager(self):
        manager=object.__new__(DashboardManager)
        import asyncio
        manager.hass=SimpleNamespace();manager.store=SimpleNamespace(async_save=AsyncMock(),async_load=AsyncMock(return_value=None));manager.users={};manager.shared={};manager.registered=set();manager.entry_id='entry';manager.lock=asyncio.Lock()
        return manager

    async def test_save_requires_explicit_approval(self):
        m=self.manager()
        for value in (None,False,1,'true'):
            with self.assertRaisesRegex(ValueError,'confirmation_required'):await m.save('alice',PROFILE,value)
        self.assertEqual(m.users,{})
        m.store.async_save.assert_not_awaited()

    async def test_personal_dashboards_are_isolated_and_copied(self):
        m=self.manager();await m.save('alice',PROFILE,True)
        self.assertEqual(m.snapshot('bob')['dashboards'],[])
        copy=m.snapshot('alice');copy['dashboards'][0]['name']='changed'
        self.assertEqual(m.snapshot('alice')['dashboards'][0]['name'],'Bayern Munich')
        await m.remove('bob','team:'+PROFILE['target'])
        self.assertEqual(len(m.snapshot('alice')['dashboards']),1)

    async def test_storage_failure_does_not_claim_approval(self):
        m=self.manager();m.store.async_save.side_effect=OSError('disk full')
        with self.assertRaises(OSError):await m.save('alice',PROFILE,True)
        self.assertEqual(m.users,{})

    async def test_sidebar_needs_admin_and_previously_approved_profile(self):
        m=self.manager();m.register=AsyncMock()
        key='team:'+PROFILE['target']
        with self.assertRaisesRegex(ValueError,'admin_required'):await m.publish('alice',key,True,False)
        with self.assertRaisesRegex(ValueError,'approve_first'):await m.publish('alice',key,True,True)
        await m.save('alice',PROFILE,True)
        with self.assertRaisesRegex(ValueError,'confirmation_required'):await m.publish('alice',key,False,True)
        with self.assertRaisesRegex(ValueError,'approve_first'):await m.publish('bob',key,True,True)
        m.register.assert_not_awaited()
        await m.publish('alice',key,True,True)
        self.assertEqual(len(m.shared),1)
        self.assertNotIn('alice',str(m.snapshot('bob')))
        await m.publish('alice',key,True,True)
        self.assertEqual(len(m.shared),1)

    async def test_removing_personal_dashboard_does_not_remove_shared_one(self):
        m=self.manager();m.register=AsyncMock();key='team:'+PROFILE['target']
        await m.save('alice',PROFILE,True);await m.publish('alice',key,True,True)
        await m.remove('alice',key)
        self.assertEqual(m.snapshot('alice')['dashboards'],[])
        self.assertEqual(len(m.shared),1)
        with self.assertRaisesRegex(ValueError,'admin_required'):await m.unpublish(key,False)
        await m.unpublish(key,True);self.assertEqual(m.shared,{})

    async def test_load_restores_approved_profiles(self):
        m=self.manager();await m.save('alice',PROFILE,True)
        saved=deepcopy(m.store.async_save.call_args.args[0]);other=self.manager();other.store.async_load.return_value=saved
        await other.load();self.assertEqual(other.snapshot('alice'),m.snapshot('alice'))

    async def test_websocket_uses_authenticated_user_and_rejects_unapproved_save(self):
        m=self.manager();hass=SimpleNamespace(data={DATA_KEY:m})
        connection=SimpleNamespace(user=SimpleNamespace(id='alice',is_admin=False),send_error=Mock(),send_result=Mock())
        handler=websocket_dashboards.__wrapped__
        await handler(hass,connection,{'id':1,'action':'save','dashboard':PROFILE})
        self.assertEqual(connection.send_error.call_args.args[1],'confirmation_required')
        self.assertEqual(m.users,{})
        await handler(hass,connection,{'id':2,'action':'save','dashboard':PROFILE,'confirmed':True})
        connection.user=SimpleNamespace(id='bob',is_admin=False)
        await handler(hass,connection,{'id':3})
        self.assertEqual(connection.send_result.call_args.args[1]['dashboards'],[])
        await handler(hass,connection,{'id':4,'action':'publish','key':'team:'+PROFILE['target'],'confirmed':True})
        self.assertEqual(connection.send_error.call_args.args[1],'admin_required')
        connection.user=None
        await handler(hass,connection,{'id':5})
        self.assertEqual(connection.send_error.call_args.args[1],'unauthorized')

    async def test_unrelated_panel_is_never_overwritten(self):
        m=self.manager()
        with patch('custom_components.sports_hub.dashboards.frontend.async_panel_exists',return_value=True),patch('custom_components.sports_hub.dashboards.frontend.async_remove_panel') as remove:
            with self.assertRaisesRegex(ValueError,'panel_path_in_use'):await m.register({**clean_dashboard(PROFILE),'path':'sports-hub-existing'})
            remove.assert_not_called()

    def test_metadata_rejects_css_and_script_urls(self):
        data=clean_dashboard({**PROFILE,'color':'red;position:fixed','alternate_color':'url(x)','logo':'javascript:alert(1)'})
        self.assertEqual(data['color'],'#315bd6');self.assertEqual(data['alternate_color'],'#ffffff');self.assertEqual(data['logo'],'')
        with self.assertRaises(ValueError):clean_dashboard({**PROFILE,'sport':'unknown'})

if __name__=='__main__':unittest.main()
