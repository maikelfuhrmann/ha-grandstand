"""Dossier data must stay scoped, fresh-labelled and safe to render."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import json
import unittest
from unittest.mock import AsyncMock, Mock

from custom_components.sports_hub.catalog import LEAGUES
from custom_components.sports_hub.enrichment import EnrichmentProvider
from custom_components.sports_hub.enrichment_model import normalize_schedule, normalize_table, normalize_roster, normalize_news_xml, normalize_f1, numeric, infer_home_venue
from custom_components.sports_hub.context import websocket_context, CONTEXT_KEY
from custom_components.sports_hub.dashboards import DATA_KEY

LEAGUE=LEAGUES['soccer:ger.1']
PROFILE={'key':'team:soccer:s:600~t:125','kind':'team','target':'soccer:s:600~t:125','sport':'soccer','name':'Example club'}
NOW=datetime.now(timezone.utc)
def item(data):return {'data':data,'updated_at':NOW.isoformat(),'error':False,'expires':NOW+timedelta(hours=1)}
def fixture(id='1',league='ger.dfb_pokal',year=2026):
    return {'id':id,'date':f'{year}-12-02T19:45Z','name':'Away at Home','season':{'year':year},'league':{'slug':league,'name':'Cup','isTournament':True},'seasonType':{'id':'4','name':'Round of 16'},'competitions':[{'id':id,'date':f'{year}-12-02T19:45Z','status':{'type':{'state':'pre','name':'STATUS_SCHEDULED'}},'competitors':[{'homeAway':'home','team':{'id':'125','displayName':'Home'}},{'homeAway':'away','team':{'id':'124','displayName':'Away'}}]}]}

class EnrichmentModels(unittest.TestCase):
    def home_fixture(self, name='Allianz Arena', date='2026-10-31T17:30Z', league='ger.1', neutral=False, state='post', home=True):
        raw=fixture(league=league);raw['date']=date
        comp=raw['competitions'][0];comp['date']=date;comp['neutralSite']=neutral
        comp['status']={'type':{'state':state,'name':'STATUS_FINAL' if state=='post' else 'STATUS_SCHEDULED'}}
        comp['venue']={'fullName':name,'address':{'city':'München','country':'Germany'}}
        if not home:comp['competitors'][0]['homeAway']='away'
        return normalize_schedule({'events':[raw]},LEAGUE,'125')[0]
    def test_home_stadium_excludes_friendly_tour_even_when_marked_home(self):
        tour=self.home_fixture('Kai Tak Sports Park','2026-08-07T12:00Z','club.friendly')
        home=self.home_fixture()
        venue=infer_home_venue([tour,home],'125',LEAGUE['id'],datetime(2026,11,8,tzinfo=timezone.utc))
        self.assertEqual(venue['name'],'Allianz Arena');self.assertEqual(venue['city'],'München')
        self.assertIsNone(infer_home_venue([tour],'125',LEAGUE['id']))
    def test_neutral_unknown_and_away_venues_do_not_become_home_stadium(self):
        rows=[self.home_fixture(neutral=True),self.home_fixture(neutral=None),self.home_fixture(home=False),self.home_fixture(league='ger.dfb_pokal')]
        self.assertIsNone(infer_home_venue(rows,'125',LEAGUE['id']))
        self.assertTrue(rows[0]['neutral_site']);self.assertIsNone(rows[1]['neutral_site'])
    def test_recent_actual_home_venue_precedes_old_and_future_venues(self):
        old=self.home_fixture('Old stadium','2026-08-01T12:00Z')
        current=self.home_fixture()
        future=self.home_fixture('Future stadium','2026-12-01T12:00Z',state='pre')
        self.assertEqual(infer_home_venue([future,old,current],'125',LEAGUE['id'],datetime(2026,11,8,tzinfo=timezone.utc))['name'],'Allianz Arena')
    def test_next_regular_home_fixture_is_fallback_before_season_starts(self):
        near=self.home_fixture('Next stadium','2026-11-20T12:00Z',state='pre')
        later=self.home_fixture('Later stadium','2026-12-01T12:00Z',state='pre')
        self.assertEqual(infer_home_venue([later,near],'125',LEAGUE['id'],datetime(2026,11,8,tzinfo=timezone.utc))['name'],'Next stadium')
    def test_cross_competition_fixture_has_correct_league_and_round(self):
        events=normalize_schedule({'events':[fixture()]},LEAGUE,'125')
        self.assertEqual(len(events),1);self.assertEqual(events[0]['league_id'],'soccer:ger.dfb_pokal')
        self.assertEqual(events[0]['round'],'Round of 16');self.assertTrue(events[0]['tournament'])
        self.assertEqual(normalize_schedule({'events':[fixture()]},LEAGUE,'999'),[])
    def test_fixture_uses_its_own_competition_logo(self):
        raw=fixture();raw['league']['logos']=[{'href':'https://example.com/cup.png'}]
        event=normalize_schedule({'events':[raw]},LEAGUE,'125')[0]
        self.assertEqual(event['league_id'],'soccer:ger.dfb_pokal')
        self.assertEqual(event['league_logo'],'https://example.com/cup.png')
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
    async def test_club_home_venue_and_away_event_radar_stay_separate(self):
        home=fixture('home',league='ger.1');home['date']='2026-10-31T17:30Z'
        c=home['competitions'][0];c.update({'date':home['date'],'neutralSite':False,'status':{'type':{'state':'post'}},'venue':{'fullName':'Allianz Arena','address':{'city':'München','country':'Germany'}}})
        tour=fixture('tour',league='club.friendly');tour['date']='2026-08-07T12:00Z'
        tour['competitions'][0].update({'date':tour['date'],'neutralSite':False,'status':{'type':{'state':'post'}},'venue':{'fullName':'Kai Tak Sports Park'}})
        away=fixture('away',league='ger.1');away['date']=(NOW+timedelta(days=1)).isoformat()
        c=away['competitions'][0];c.update({'date':away['date'],'neutralSite':False,'venue':{'fullName':'Away stadium','address':{'city':'Away city','country':'Germany'},'coordinates':{'latitude':50,'longitude':8}}});c['competitors'][0]['homeAway']='away'
        p=EnrichmentProvider(None)
        async def get(url,*args):
            if '/schedule?' in url:return item({'events':[away]})
            if '/schedule' in url:return item({'events':[tour,home]})
            if '/roster' in url:return item({})
            if '/teams/125' in url:return item({'team':{'id':'125','defaultLeague':{'slug':'ger.1'}}})
            return item({})
        p.get=AsyncMock(side_effect=get);p.news=AsyncMock(return_value={'articles':[]})
        data=await p.context(PROFILE,{})
        self.assertEqual(data['team']['venue'],'Allianz Arena');self.assertEqual(data['team']['city'],'München')
        self.assertEqual(data['radar']['location']['name'],'Away stadium')
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

class F1DossierRegression(unittest.IsolatedAsyncioTestCase):
    def calendar(self,year='2026'):
        return {'MRData':{'RaceTable':{'season':year,'Races':[
            {'season':year,'round':'1','raceName':'Previous GP','date':year+'-11-08','time':'17:00:00Z','Circuit':{'circuitId':'interlagos','circuitName':'Brazil','Location':{'lat':'-23.7','long':'-46.7'}}},
            {'season':year,'round':'2','raceName':'Next GP','date':year+'-11-22','time':'06:00:00Z','Circuit':{'circuitId':'vegas','circuitName':'Las Vegas','Location':{'lat':'36.1','long':'-115.1'}}}]}}}
    def results(self,year='2026',round_number='1'):
        return {'MRData':{'RaceTable':{'Races':[{'season':year,'round':round_number,'raceName':'Previous GP','Results':[{'position':'1','Driver':{'givenName':'Test','familyName':'Winner'},'Constructor':{'name':'Team'},'Time':{'time':'1:30:00.000'},'laps':'71','points':'25'}]}]}}}
    async def test_all_focus_data_follow_next_gp_and_old_live_data_cannot_follow(self):
        from unittest.mock import patch
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):return cls(2026,11,8,19,tzinfo=timezone.utc)
        p=EnrichmentProvider(None)
        async def get(url,*args,**kwargs):
            if '/current.json' in url:return item(self.calendar())
            return item({})
        p.get=AsyncMock(side_effect=get);p.news=AsyncMock(return_value={});p.f1_weekend=AsyncMock(return_value={});p.f1_forecast=AsyncMock(return_value=None)
        live={'current_session':{'state':'Race','attributes':{'start':'2026-11-08T17:00:00Z','live_status':'Finished'}}}
        with patch('custom_components.sports_hub.enrichment.datetime',Clock),patch('custom_components.sports_hub.f1_results.datetime',Clock):
            data=(await p.f1({'key':'f1'},'en',live))['f1']
            cleared=(await p.f1({'key':'f1'},'en',{}))['f1']
            self.assertEqual(cleared['focus']['round'],'2')
        self.assertEqual(data['focus']['round'],'2');self.assertEqual(data['radar']['location']['name'],'Las Vegas')
        self.assertFalse(data['live_available']);self.assertEqual(data['last_completed']['round'],'1')
        self.assertEqual(p.f1_weekend.call_args.args[1]['round'],'2');self.assertEqual(p.f1_forecast.call_args.args[0]['round'],'2')
    async def test_archive_keeps_selected_year_and_round_and_rejects_mismatched_results(self):
        p=EnrichmentProvider(None)
        async def get(url,*args,**kwargs):
            if '2025.json' in url:return item(self.calendar('2025'))
            if '/results.json' in url:return item(self.results('2025','1'))
            return item({'MRData':{'RaceTable':{'Races':[{'season':'2025','round':'1','QualifyingResults':[{'position':'1','number':'1','Driver':{'givenName':'Test','familyName':'Pole'}}]}]}}})
        p.get=AsyncMock(side_effect=get)
        one=await p.f1_archive({'key':'f1'},2025,1);self.assertEqual(one['results'][0]['name'],'Test Winner');self.assertEqual(one['qualifying'][0]['name'],'Test Pole')
        two=await p.f1_archive({'key':'f1'},2025,2);self.assertEqual(two['results'],[]);self.assertEqual(two['qualifying'],[]);self.assertEqual(two['race']['name'],'Next GP')
        missing=await p.f1_archive({'key':'f1'},2025,39);self.assertEqual(missing['results'],[])
    async def test_archive_requires_approved_f1_dashboard_and_rejects_future_year(self):
        provider=SimpleNamespace(f1_archive=AsyncMock(return_value={'kind':'f1_archive'}))
        profile={'key':'league:racing:f1','target':'racing:f1'}
        manager=SimpleNamespace(users={'alice':{profile['key']:profile}},shared={})
        hass=SimpleNamespace(data={DATA_KEY:manager,CONTEXT_KEY:provider})
        conn=SimpleNamespace(user=SimpleNamespace(id='bob'),send_error=Mock(),send_result=Mock())
        msg={'id':1,'key':profile['key'],'season':2025}
        await websocket_context.__wrapped__(hass,conn,msg);provider.f1_archive.assert_not_awaited()
        conn.user.id='alice';await websocket_context.__wrapped__(hass,conn,msg);provider.f1_archive.assert_awaited_once()
        await websocket_context.__wrapped__(hass,conn,{**msg,'season':9999});self.assertEqual(conn.send_error.call_args.args[1],'invalid_selection')
    async def test_forecast_uses_selected_track_and_exact_race_hour_not_current_weather(self):
        p=EnrichmentProvider(None);date=(NOW+timedelta(days=4)).replace(minute=0,second=0,microsecond=0)
        race={'name':'Next GP','date':date.isoformat(),'sessions':[{'name':'Race','time_confirmed':True}],'location':{'latitude':36.1,'longitude':-115.1}}
        p.get=AsyncMock(return_value=item({'hourly':{'time':[NOW.timestamp(),date.timestamp()],'temperature_2m':[30,15],'precipitation_probability':[0,25],'wind_speed_10m':[8,12]}}))
        forecast=await p.f1_forecast(race);self.assertEqual(forecast['values']['temperature_2m'],15)
        self.assertIn('latitude=36.1',p.get.call_args.args[0]);self.assertEqual(forecast['meeting'],'Next GP')
        p.get=AsyncMock(return_value=item({'hourly':{'time':[NOW.timestamp()],'temperature_2m':[30]}}))
        self.assertIsNone(await p.f1_forecast(race))
