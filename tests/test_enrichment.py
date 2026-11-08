"""Dossier data must stay scoped, fresh-labelled and safe to render."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import json
import unittest
from unittest.mock import AsyncMock, Mock

from custom_components.sports_hub.catalog import LEAGUES
from custom_components.sports_hub.enrichment import EnrichmentProvider
from custom_components.sports_hub.enrichment_model import normalize_schedule, normalize_table, normalize_roster, normalize_news_xml, normalize_f1, numeric
from custom_components.sports_hub.context import websocket_context, CONTEXT_KEY
from custom_components.sports_hub.dashboards import DATA_KEY

LEAGUE=LEAGUES['soccer:ger.1']
PROFILE={'key':'team:soccer:s:600~t:125','kind':'team','target':'soccer:s:600~t:125','sport':'soccer','name':'Example club'}
NOW=datetime.now(timezone.utc)
def item(data):return {'data':data,'updated_at':NOW.isoformat(),'error':False,'expires':NOW+timedelta(hours=1)}
def fixture(id='1',league='ger.dfb_pokal',year=2026):
    return {'id':id,'date':f'{year}-12-02T19:45Z','name':'Away at Home','season':{'year':year},'league':{'slug':league,'name':'Cup','isTournament':True},'seasonType':{'id':'4','name':'Round of 16'},'competitions':[{'id':id,'date':f'{year}-12-02T19:45Z','status':{'type':{'state':'pre','name':'STATUS_SCHEDULED'}},'competitors':[{'homeAway':'home','team':{'id':'125','displayName':'Home'}},{'homeAway':'away','team':{'id':'124','displayName':'Away'}}]}]}

class EnrichmentModels(unittest.TestCase):
    def test_cross_competition_fixture_has_correct_league_and_round(self):
        events=normalize_schedule({'events':[fixture()]},LEAGUE,'125')
        self.assertEqual(len(events),1);self.assertEqual(events[0]['league_id'],'soccer:ger.dfb_pokal')
        self.assertEqual(events[0]['round'],'Round of 16');self.assertTrue(events[0]['tournament'])
        self.assertEqual(normalize_schedule({'events':[fixture()]},LEAGUE,'999'),[])
    def test_grouped_standings_keep_numeric_zero_and_escape_at_render(self):
        data={'children':[{'name':'Eastern conference','standings':{'entries':[{'team':{'id':'1','displayName':'A & B'},'stats':[{'name':'wins','value':0,'displayValue':'0'},{'name':'points','value':12,'displayValue':'12'}]}]}}]}
        table=normalize_table(data,LEAGUE);self.assertEqual(table['groups'][0]['entries'][0]['stats']['wins']['value'],0)
        self.assertIsNone(numeric('nan'));self.assertIsNone(numeric('inf'))
    def test_grouped_rosters_and_unsafe_photo(self):
        roster=normalize_roster({'athletes':[{'items':[{'id':'1','displayName':'Player','jersey':'0','headshot':{'href':'javascript:alert(1)'},'position':{'abbreviation':'G'}}]}]})
        self.assertEqual(roster[0]['number'],'0');self.assertEqual(roster[0]['photo'],'')
    def test_news_is_headlines_only_bounded_and_fresh(self):
        xml=b'''<rss><channel><item><title>Headline - Publisher</title><link>https://example.com/story</link><source>Publisher</source><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate><description>&lt;script&gt;ignore&lt;/script&gt;</description></item><item><title>Unsafe</title><link>javascript:alert(1)</link><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Old</title><link>https://example.com/old</link><pubDate>Sun, 01 Nov 2020 10:00:00 GMT</pubDate></item></channel></rss>'''
        rows=normalize_news_xml(xml,datetime(2026,11,8,12,tzinfo=timezone.utc));self.assertEqual(len(rows),1);self.assertEqual(rows[0]['title'],'Headline');self.assertNotIn('description',rows[0])
    def test_f1_calendar_preserves_unconfirmed_times(self):
        result=normalize_f1({'MRData':{'RaceTable':{'season':'2026','Races':[{'round':'1','raceName':'Test GP','date':'2026-12-01','Qualifying':{'date':'2026-11-30','time':'14:00:00Z'}}]}}},{},{},{})
        self.assertEqual(result['calendar'][0]['sessions'][0]['name'],'Qualifying');self.assertFalse(result['calendar'][0]['sessions'][1]['time_confirmed']);self.assertEqual(result['drivers'],[])

class FakeResponse:
    def __init__(self,session):self.session=session;self.content=self
    async def __aenter__(self):await asyncio.sleep(0);return self
    async def __aexit__(self,*a):pass
    def raise_for_status(self):
        if self.session.fail:raise ValueError('bad payload')
    async def iter_chunked(self,size):yield json.dumps(self.session.payload).encode()
class FakeSession:
    def __init__(self):self.calls=[];self.payload={'events':[]};self.fail=False
    def get(self,url,**kwargs):self.calls.append(url);return FakeResponse(self)

class EnrichmentProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_parallel_calls_deduplicate_and_failures_keep_old_data(self):
        s=FakeSession();p=EnrichmentProvider(s)
        a,b=await asyncio.gather(p.get('https://example.com'),p.get('https://example.com'))
        self.assertEqual(len(s.calls),1);self.assertEqual(a,b)
        p.cache['https://example.com']['expires']=NOW-timedelta(days=1);s.fail=True
        result=await p.get('https://example.com');self.assertTrue(result['error']);self.assertEqual(result['data'],{'events':[]});self.assertEqual(result['updated_at'],a['updated_at'])
        await asyncio.sleep(0);self.assertEqual(p.pending,{})
    async def test_soccer_all_schedule_reconciles_stable_team_keys(self):
        p=EnrichmentProvider(None)
        async def get(url,*args):
            if '/teams/125/schedule' in url:return item({'events':[fixture()]})
            if '/roster' in url:return item({'athletes':[]})
            if '/teams/125' in url:return item({'team':{'id':'125','displayName':'Example','defaultLeague':{'slug':'ger.1'}}})
            return item({})
        p.get=AsyncMock(side_effect=get);p.news=AsyncMock(return_value={'articles':[]})
        data=await p.context(PROFILE,{})
        self.assertEqual(len(data['events']),1);self.assertEqual(data['events'][0]['participants'][0]['key'],PROFILE['target'])
        self.assertTrue(any('/soccer/all/teams/125/schedule' in call.args[0] for call in p.get.call_args_list))
        self.assertEqual(len(data['competitions']),2)
    async def test_league_season_crosses_new_year_without_mixing_seasons(self):
        p=EnrichmentProvider(None)
        async def get(url,*args):
            if '/scoreboard?' in url:return item({'events':[fixture('current',year=2026),fixture('previous',year=2025)]})
            if url.endswith('/scoreboard'):return item({'leagues':[{'season':{'year':2026,'startDate':'2026-08-01T00:00Z','endDate':'2027-05-31T23:59Z'}}]})
            return item({})
        p.get=AsyncMock(side_effect=get);p.news=AsyncMock(return_value={'articles':[]})
        data=await p.context({'key':'league:soccer:ger.1','kind':'league','target':'soccer:ger.1','sport':'soccer','name':'League'}, {})
        self.assertEqual(len(data['events']),1)
        urls=[c.args[0] for c in p.get.call_args_list];self.assertTrue(any('dates=202705' in u for u in urls));self.assertTrue(any('dates=202608' in u for u in urls));self.assertFalse(any('dates=202507' in u for u in urls))
    async def test_unknown_non_soccer_team_does_not_guess_a_different_league(self):
        p=EnrichmentProvider(None);league,team=p.resolve({**PROFILE,'sport':'basketball','target':'basketball:s:40~l:59~t:2'},{'leagues':[LEAGUES['basketball:nba']]})
        self.assertIsNone(league)
    async def test_context_requires_approved_dashboard_owned_or_shared(self):
        provider=SimpleNamespace(context=AsyncMock(return_value={'kind':'team','events':[]}))
        manager=SimpleNamespace(users={'alice':{PROFILE['key']:PROFILE}},shared={})
        hass=SimpleNamespace(data={DATA_KEY:manager,CONTEXT_KEY:provider,'sports_hub':{'entry':SimpleNamespace(data={})}})
        conn=SimpleNamespace(user=SimpleNamespace(id='bob'),send_error=Mock(),send_result=Mock())
        msg={'id':1,'key':PROFILE['key'],'language':'de'}
        await websocket_context.__wrapped__(hass,conn,msg);self.assertEqual(conn.send_error.call_args.args[1],'not_found');provider.context.assert_not_awaited()
        manager.shared[PROFILE['key']]=PROFILE
        await websocket_context.__wrapped__(hass,conn,msg);provider.context.assert_awaited_once()
        conn.user=None;await websocket_context.__wrapped__(hass,conn,msg);self.assertEqual(conn.send_error.call_args.args[1],'unauthorized')
