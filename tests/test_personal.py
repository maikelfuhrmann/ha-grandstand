"""Account isolation, migration, explicit sharing, schedule semantics and reminders."""
import asyncio
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase,TestCase
from unittest.mock import AsyncMock,Mock,patch
from zoneinfo import ZoneInfo

from custom_components.sports_hub.personal import PersonalManager,PERSONAL_KEY,DEFAULTS,websocket_personal,clean_settings
from custom_components.sports_hub.context import CONTEXT_KEY
from custom_components.sports_hub.dashboards import DATA_KEY
from custom_components.sports_hub.agenda import AgendaProvider,calendar_span
from custom_components.sports_hub.calendar import PersonalSportsCalendar,calendar_event
from custom_components.sports_hub.reminders import due_reminders,quiet_now,ReminderRunner

NOW=datetime(2026,11,9,14,0,tzinfo=timezone.utc)
PROFILE={'key':'team:soccer:s:600~t:132','kind':'team','target':'soccer:s:600~t:132','sport':'soccer','name':'Bayern Munich','league_id':'soccer:ger.1'}
def event(**changes):
 return {'id':'match','league_id':'soccer:ger.1','league':'Bundesliga','sport':'soccer','name':'Bayern Munich vs Example','date':(NOW+timedelta(minutes=15)).isoformat(),'state':'scheduled','time_confirmed':True,'updated_at':NOW.isoformat(),'stale':False,'participants':[{'key':PROFILE['target'],'id':'132','name':'Bayern Munich'}],**changes}

def manager():
 m=object.__new__(PersonalManager);m.users={};m.sent={};m.lock=asyncio.Lock();m.agenda_cache={};m.agenda_pending={}
 m.store=SimpleNamespace(async_save=AsyncMock(),async_load=AsyncMock(return_value=None))
 m.hass=SimpleNamespace(data={DATA_KEY:SimpleNamespace(users={'alice':{PROFILE['key']:PROFILE}})},config_entries=SimpleNamespace(async_entries=Mock(return_value=[])))
 m.hass.services=SimpleNamespace(has_service=Mock(return_value=True),async_call=AsyncMock())
 m.hass.auth=SimpleNamespace(async_get_user=AsyncMock(return_value=SimpleNamespace(is_active=True,name='Alice')))
 m.hass.config=SimpleNamespace(time_zone='Europe/Berlin')
 return m

class PersonalTests(IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.dispatch=patch('custom_components.sports_hub.personal.async_dispatcher_send');self.dispatch.start();self.addCleanup(self.dispatch.stop)
 async def test_first_device_migration_and_other_user_isolation(self):
  m=manager();await m.update('alice','initialize',{'legacy':{'favorites':[PROFILE['target']],'hideScores':True}})
  self.assertTrue(m.snapshot('alice')['settings']['hide_scores']);self.assertIn(PROFILE['target'],m.snapshot('alice')['favorites'])
  self.assertEqual(m.snapshot('bob')['favorites'],{})
  await m.update('alice','initialize',{'legacy':{'favorites':['soccer:other']}})
  self.assertNotIn('soccer:other',m.snapshot('alice')['favorites'])
  copy=m.snapshot('alice');copy['favorites'].clear();self.assertTrue(m.snapshot('alice')['favorites'])
 async def test_empty_legacy_favorites_are_not_repopulated(self):
  m=manager();await m.update('alice','initialize',{'legacy':{'favorites':[]}});self.assertEqual(m.snapshot('alice')['favorites'],{})
 async def test_new_device_seeds_only_own_approved_dashboards(self):
  m=manager();await m.update('alice','initialize',{});await m.update('bob','initialize',{})
  self.assertIn(PROFILE['target'],m.snapshot('alice')['favorites']);self.assertFalse(m.snapshot('bob')['favorites'])
 async def test_parallel_favorite_changes_do_not_overwrite_each_other(self):
  m=manager();await asyncio.gather(m.update('alice','favorite',{'key':'league:racing:f1','enabled':True}),m.update('alice','favorite',{'key':PROFILE['target'],'enabled':True,'profile':PROFILE}))
  self.assertEqual(len(m.snapshot('alice')['favorites']),2)
  await m.update('alice','favorite',{'key':PROFILE['target'],'enabled':False});self.assertNotIn(PROFILE['target'],m.snapshot('alice')['favorites'])
 async def test_failed_save_rolls_back_and_no_false_success(self):
  m=manager();m.store.async_save.side_effect=OSError('full')
  with self.assertRaises(OSError):await m.update('alice','initialize',{})
  self.assertEqual(m.users,{})
 async def test_calendar_is_private_until_admin_publishes(self):
  m=manager();self.assertFalse(m.snapshot('alice')['settings']['calendar_shared'])
  with self.assertRaisesRegex(ValueError,'admin_required'):await m.update('alice','settings',{'settings':{'calendar_shared':True}})
  await m.update('alice','settings',{'settings':{'calendar_shared':True}},True)
  calendar=PersonalSportsCalendar(m,'alice','entry');m.feed=AsyncMock(return_value={'events':[event()]});calendar.hass=m.hass
  self.assertEqual(len(await calendar.async_get_events(m.hass,NOW,NOW+timedelta(days=1))),1)
  await m.update('alice','settings',{'settings':{'calendar_shared':False}},True)
  self.assertEqual(await calendar.async_get_events(m.hass,NOW,NOW+timedelta(days=1)),[]);self.assertIsNone(calendar.event)
 async def test_device_selection_cannot_target_another_user(self):
  m=manager();own=SimpleNamespace(entry_id='own',title='Phone',data={'user_id':'alice','webhook_id':'secret-own'});other=SimpleNamespace(entry_id='other',title='Other phone',data={'user_id':'bob','webhook_id':'secret-other'})
  m.hass.config_entries.async_entries.return_value=[own,other];m.hass.data['mobile_app']={'notify':SimpleNamespace(registered_targets={'mobile_app_own':'secret-own','mobile_app_other':'secret-other'})}
  self.assertEqual(m.devices('alice'),[{'id':'own','name':'Phone'}]);self.assertIsNone(m.notification_service('alice','other'))
  with self.assertRaisesRegex(ValueError,'device_required'):await m.update('alice','settings',{'settings':{'reminders_enabled':True,'reminder_device':'other'}},True)
  await m.update('alice','settings',{'settings':{'reminders_enabled':True,'reminder_device':'own'}})
  self.assertEqual(m.notification_service('alice','own'),'mobile_app_own')
 async def test_websocket_has_no_caller_supplied_user_scope(self):
  m=manager();m.hass.data[PERSONAL_KEY]=m;conn=SimpleNamespace(user=None,send_error=Mock(),send_result=Mock())
  await websocket_personal.__wrapped__(m.hass,conn,{'id':1});self.assertEqual(conn.send_error.call_args.args[1],'unauthorized')
  conn.user=SimpleNamespace(id='bob',is_admin=False)
  await websocket_personal.__wrapped__(m.hass,conn,{'id':2,'action':'initialize','user_id':'alice'})
  self.assertIn('bob',m.users);self.assertNotIn('alice',m.users)
 async def test_preferences_and_reminder_history_survive_restart(self):
  m=manager();await m.update('alice','initialize',{});m.sent={'sent-key':NOW.isoformat()};await m.persist()
  restored=manager();restored.store.async_load.return_value=deepcopy(m.store.async_save.call_args.args[0]);await restored.load()
  self.assertEqual(restored.snapshot('alice'),m.snapshot('alice'));self.assertEqual(restored.sent,m.sent)

class ReminderTests(IsolatedAsyncioTestCase):
 def settings(self):return {**DEFAULTS,'reminders_enabled':True,'reminder_device':'own','quiet_enabled':False}
 async def test_duplicate_tick_and_restart_do_not_repeat(self):
  m=manager();m.users={'alice':{'settings':self.settings()}};m.feed=AsyncMock(return_value={'events':[event()]});m.notification_service=Mock(return_value='mobile_app_own')
  runner=ReminderRunner(m);await runner.tick(NOW);await runner.tick(NOW+timedelta(seconds=30))
  self.assertEqual(m.hass.services.async_call.await_count,1)
  runner=ReminderRunner(m);await runner.tick(NOW+timedelta(seconds=60));self.assertEqual(m.hass.services.async_call.await_count,1)
  call=m.hass.services.async_call.call_args;self.assertEqual(call.args[:2],('notify','mobile_app_own'));self.assertEqual(call.kwargs['context'].user_id,'alice');self.assertIn('/sports-hub',str(call.args[2]))
 async def test_opt_out_during_schedule_fetch_prevents_push(self):
  m=manager();m.users={'alice':{'settings':self.settings()}};m.notification_service=Mock(return_value='mobile_app_own')
  async def delayed_feed(user_id):
   m.users[user_id]['settings']['reminders_enabled']=False
   return {'events':[event()]}
  m.feed=delayed_feed
  await ReminderRunner(m).tick(NOW);m.hass.services.async_call.assert_not_awaited();self.assertFalse(m.sent)
 async def test_failed_persistence_never_sends(self):
  m=manager();m.users={'alice':{'settings':self.settings()}};m.feed=AsyncMock(return_value={'events':[event()]});m.notification_service=Mock(return_value='mobile_app_own');m.store.async_save.side_effect=OSError('full')
  await ReminderRunner(m).tick(NOW);m.hass.services.async_call.assert_not_awaited();self.assertEqual(m.sent,{})
 def test_skip_unknown_stale_cancelled_and_late_events(self):
  settings=self.settings();zone=ZoneInfo('Europe/Berlin')
  for changes in ({'time_confirmed':False},{'stale':True},{'state':'postponed'},{'state':'live'},{'updated_at':(NOW-timedelta(hours=3)).isoformat()}):
   self.assertEqual(due_reminders([event(**changes)],settings,{},'alice',NOW,zone),[])
  self.assertEqual(due_reminders([event()],settings,{},'alice',NOW+timedelta(minutes=3),zone),[])
 def test_rescheduled_match_uses_new_start_and_never_old_due_time(self):
  settings=self.settings();zone=ZoneInfo('Europe/Berlin');changed=event(date=(NOW+timedelta(hours=2)).isoformat())
  self.assertFalse(due_reminders([changed],settings,{},'alice',NOW,zone))
  self.assertTrue(due_reminders([changed],settings,{},'alice',NOW+timedelta(hours=1,minutes=45),zone))
 def test_overnight_quiet_hours_use_ha_timezone_and_dst(self):
  s={**DEFAULTS,'quiet_enabled':True};z=ZoneInfo('Europe/Berlin')
  self.assertTrue(quiet_now(s,datetime(2026,10,25,1,30,tzinfo=timezone.utc),z))
  self.assertFalse(quiet_now(s,NOW,z));self.assertFalse(quiet_now({**s,'quiet_end':'22:00'},NOW,z))

class CalendarTests(TestCase):
 def test_unknown_time_is_all_day_in_ha_timezone(self):
  span=calendar_span(event(date='2026-11-09T23:30:00Z',time_confirmed=False),ZoneInfo('Europe/Berlin'))
  self.assertEqual(span[0].isoformat(),'2026-11-10');self.assertEqual(span[1].isoformat(),'2026-11-11')
 def test_estimated_end_and_stable_uid_do_not_include_scores(self):
  e=calendar_event(event(),ZoneInfo('Europe/Berlin'));self.assertEqual(e.uid,'match');self.assertEqual(e.end-e.start,timedelta(hours=2));self.assertIn('estimated',e.description)
  self.assertIsNone(calendar_event(event(state='postponed'),ZoneInfo('UTC')))
 def test_settings_validate_times_flags_and_limits(self):
  for values in ({'quiet_start':'25:00'},{'reminder_minutes':1},{'reminder_minutes':True},{'calendar_shared':'yes'},{'unknown':True}):
   with self.assertRaises(ValueError):clean_settings(values)

class CalendarUpdateTests(IsolatedAsyncioTestCase):
 async def test_reschedule_pushes_changed_calendar_only(self):
  m=manager();m.users={'alice':{'settings':{**DEFAULTS,'calendar_shared':True,'language':'de'}}}
  m.feed=AsyncMock(return_value={'events':[event()]})
  calendar=PersonalSportsCalendar(m,'alice','entry');calendar.hass=m.hass;calendar.async_update_event_listeners=Mock()
  await calendar.async_update();await calendar.async_update()
  self.assertEqual(calendar.async_update_event_listeners.call_count,1)
  m.feed.return_value={'events':[event(date=(NOW+timedelta(hours=4)).isoformat())]}
  await calendar.async_update();self.assertEqual(calendar.async_update_event_listeners.call_count,2)
  self.assertIn('geschätzte',calendar._signature[0][-1])

class AgendaTests(IsolatedAsyncioTestCase):
 async def test_team_schedule_keeps_cross_competition_identity_and_live_scoreboard(self):
  league={'id':'soccer:ger.1','sport':'soccer','path':'ger.1','name':'Bundesliga'}
  cup=event(id='cup',league_id='soccer:ger.dfb_pokal',league='DFB Pokal')
  league_event=event()
  provider=SimpleNamespace(resolve=Mock(return_value=(league,'132')),get=AsyncMock(return_value={'data':{},'error':False,'updated_at':NOW.isoformat()}))
  live=event(state='live')
  with patch('custom_components.sports_hub.agenda.enrich_profile_events',return_value=[cup,league_event]):
   feed=await AgendaProvider(provider).events([PROFILE],{'events':[live]},{PROFILE['target']:{}},NOW,NOW+timedelta(days=90))
  self.assertEqual({e['id'] for e in feed['events']},{'match','cup'})
  self.assertEqual(next(e for e in feed['events'] if e['id']=='match')['state'],'live')
  self.assertTrue(all('/soccer/all/teams/132/schedule' in call.args[0] for call in provider.get.call_args_list))
 async def test_f1_calendar_includes_sessions_and_prefers_live_session(self):
  league={'id':'racing:f1','sport':'racing','path':'f1','name':'Formula 1'}
  profile={'kind':'league','target':'racing:f1','name':'Formula 1'}
  payload={'MRData':{'RaceTable':{'season':'2026','Races':[{'round':'1','raceName':'Test GP','date':'2026-11-15','time':'14:00:00Z','FirstPractice':{'date':'2026-11-13','time':'10:00:00Z'},'Qualifying':{'date':'2026-11-14'},'Circuit':{'circuitName':'Circuit','Location':{}}}]}}}
  provider=SimpleNamespace(resolve=Mock(return_value=(league,None)),get=AsyncMock(return_value={'data':payload,'error':True,'updated_at':NOW.isoformat()}))
  race=event(id='real-race',sport='racing',league_id='racing:f1',date='2026-11-15T14:00:00Z',state='live')
  feed=await AgendaProvider(provider).events([profile],{'events':[race]},{'league:racing:f1':{}},NOW,NOW+timedelta(days=90))
  self.assertEqual(len(feed['events']),3)
  self.assertEqual(sum(e['date']=='2026-11-15T14:00:00Z' for e in feed['events']),1)
  qualifying=next(e for e in feed['events'] if e.get('subtitle')=='Qualifying')
  self.assertFalse(qualifying['time_confirmed']);self.assertTrue(qualifying['stale']);self.assertTrue(qualifying['calendar_only'])
