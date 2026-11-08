"""Exercise partial failures, date caching and revalidation without network calls."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import unittest
from unittest.mock import AsyncMock

from custom_components.sports_hub.provider import ScoreboardProvider
from custom_components.sports_hub.catalog import LEAGUES

NOW=datetime(2026,11,8,15,tzinfo=timezone.utc)
LEAGUE='soccer:ger.1'

class Response:
    def __init__(self,payload):self.payload=payload
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def raise_for_status(self):pass
    async def json(self,**kwargs):
        if isinstance(self.payload,Exception):raise self.payload
        return self.payload

class Session:
    def __init__(self):self.calls=[];self.payload={'events':[]}
    def get(self,url,**kwargs):self.calls.append((url,kwargs));return Response(self.payload)

class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_daily_requests_not_rejected_date_ranges(self):
        session=Session();provider=ScoreboardProvider(session,[LEAGUE],time_zone=ZoneInfo('Europe/Berlin'))
        first=await provider.update(NOW)
        self.assertEqual(len(session.calls),3)
        self.assertTrue(first['loading'])
        self.assertTrue(all(len(call[1]['params']['dates'])==8 for call in session.calls))
        second=await provider.update(NOW+timedelta(seconds=30))
        self.assertFalse(second['loading'])
        call_count=len(session.calls)
        await provider.update(NOW+timedelta(seconds=60))
        self.assertEqual(len(session.calls),call_count)

    async def test_failures_do_not_replace_valid_cached_results(self):
        session=Session();provider=ScoreboardProvider(session,[LEAGUE]);start,end=provider.window(NOW)
        key=(LEAGUE,NOW.date().isoformat())
        event={'id':'match','date':NOW.isoformat(),'state':'live','participants':[]}
        provider.cache[key]={'events':[event],'updated_at':NOW.isoformat(),'next_poll':NOW,'failures':0}
        session.payload=ValueError('invalid json')
        await provider._fetch(LEAGUES[LEAGUE],NOW.date(),NOW+timedelta(seconds=30),start,end)
        snapshot=provider.snapshot(NOW+timedelta(seconds=30))
        self.assertEqual(snapshot['events'][0]['id'],'match')
        self.assertTrue(snapshot['events'][0]['stale'])
        self.assertEqual(snapshot['leagues'][0]['error'],'unavailable')

    async def test_overlapping_days_deduplicate_and_choose_newest_success(self):
        provider=ScoreboardProvider(Session(),[LEAGUE]);event={'id':'same','date':NOW.isoformat(),'state':'live','participants':[]}
        provider.cache[(LEAGUE,'2026-11-07')]={'events':[event],'updated_at':(NOW-timedelta(minutes=5)).isoformat(),'error':'unavailable'}
        provider.cache[(LEAGUE,'2026-11-08')]={'events':[{**event,'name':'fresh'}],'updated_at':NOW.isoformat(),'error':None}
        snapshot=provider.snapshot(NOW)
        self.assertEqual(len(snapshot['events']),1)
        self.assertEqual(snapshot['events'][0]['name'],'fresh')
        self.assertFalse(snapshot['events'][0]['stale'])

    async def test_empty_scoreboard_is_not_source_failure(self):
        provider=ScoreboardProvider(Session(),[LEAGUE]);snapshot=await provider.update(NOW)
        self.assertEqual(snapshot['events'],[])
        self.assertIsNone(snapshot['leagues'][0]['error'])

    async def test_timezone_window_respects_dst(self):
        provider=ScoreboardProvider(Session(),[LEAGUE],days_back=1,days_ahead=1,time_zone=ZoneInfo('Europe/Berlin'))
        start,end=provider.window(datetime(2026,10,25,12,tzinfo=timezone.utc))
        self.assertEqual(start.isoformat(),'2026-10-23T22:00:00+00:00')
        self.assertEqual(end.isoformat(),'2026-10-26T23:00:00+00:00')

    async def test_future_cache_switches_to_live_polling_before_old_deadline(self):
        provider=ScoreboardProvider(Session(),[LEAGUE]);day=NOW.date()
        provider.cache[(LEAGUE,day.isoformat())]={'events':[{'state':'scheduled','date':(NOW+timedelta(minutes=5)).isoformat()}],'updated_at':(NOW-timedelta(minutes=5)).isoformat(),'next_poll':NOW+timedelta(hours=4),'error':None}
        self.assertTrue(provider.due(LEAGUE,day,NOW))

if __name__=='__main__':unittest.main()
