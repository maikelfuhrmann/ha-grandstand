"""Practice laps and stints must agree without inferring unpublished results."""
from datetime import datetime, timezone
from types import SimpleNamespace
import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from custom_components.sports_hub.f1_practice import practice_sessions, practice_rows, official_practice_rows
from custom_components.sports_hub.enrichment import EnrichmentProvider
from custom_components.sports_hub.context import websocket_context, CONTEXT_KEY
from custom_components.sports_hub.dashboards import DATA_KEY

SESSION={'session_key':10,'meeting_key':1}
def scoped(**kw):return {**SESSION,**kw}
RESULT=scoped(driver_number=63,position=1,number_of_laps=23,duration=107.272,gap_to_leader=0)
DRIVER=scoped(driver_number=63,full_name='George Russell',team_name='Mercedes',team_colour='00D7B6')
STINTS=[scoped(driver_number=63,stint_number=i+1,lap_start=start,lap_end=end,compound=c,tyre_age_at_start=age)
        for i,(start,end,c,age) in enumerate([(1,6,'WET',1),(7,11,'INTERMEDIATE',0),(12,17,'INTERMEDIATE',5),(18,23,'INTERMEDIATE',0)])]
def rows(results=None,stints=None,laps=None,drivers=None):
    return practice_rows(SESSION,results if results is not None else [RESULT],drivers if drivers is not None else [DRIVER],stints if stints is not None else STINTS,laps or [])
def item(data):return {'data':data,'updated_at':'2025-11-21T06:00:00Z','error':False}
def calendar(year=2025):
    return {'MRData':{'RaceTable':{'season':str(year),'Races':[{'season':str(year),'round':'21','raceName':'Las Vegas Grand Prix','date':f'{year}-11-23','time':'04:00:00Z','Circuit':{'circuitId':'vegas','circuitName':'Las Vegas Street Circuit','Location':{'lat':'36.1','long':'-115.2'}},'FirstPractice':{'date':f'{year}-11-21','time':'00:30:00Z'},'SecondPractice':{'date':f'{year}-11-21','time':'04:00:00Z'},'ThirdPractice':{'date':f'{year}-11-22','time':'00:30:00Z'}}]}}}
def session(year=2025,number=2):return {**SESSION,'year':year,'session_type':'Practice','session_name':f'Practice {number}','date_start':f'{year}-11-21T04:00:00Z','date_end':f'{year}-11-21T05:00:00Z'}

class PracticeNormalization(unittest.TestCase):
    def test_23_session_laps_are_6_wet_and_17_intermediate_not_tyre_age(self):
        laps=[scoped(driver_number=63,lap_number=1,lap_duration=None,is_pit_out_lap=True),scoped(driver_number=63,lap_number=23,lap_duration=107.272,is_pit_out_lap=False)]
        r=rows(laps=laps)[0]
        self.assertEqual(r['laps'],23);self.assertEqual(r['compounds'],{'WET':6,'INTERMEDIATE':17})
        self.assertEqual([s['laps'] for s in r['stints']],[6,5,6,6]);self.assertEqual(r['stints'][2]['tyre_age'],5)
        self.assertEqual(r['unassigned_laps'],0);self.assertEqual(r['best_compound'],'INTERMEDIATE')
        self.assertEqual(r['stints'][-1]['best'],107.272)
    def test_duplicate_stint_does_not_double_count_and_overlaps_remain_unknown(self):
        self.assertEqual(rows(stints=STINTS+[STINTS[0]])[0]['compounds'],{'WET':6,'INTERMEDIATE':17})
        overlapping=[STINTS[0],{**STINTS[1],'lap_start':5,'lap_end':25}]
        r=rows(stints=overlapping)[0]
        self.assertEqual(r['compounds'],{'WET':4,'INTERMEDIATE':17});self.assertEqual(r['unassigned_laps'],2)
        self.assertEqual(sum(s['laps'] for s in r['stints']),21)
    def test_wrong_session_and_meeting_cannot_leak_into_classification_or_stints(self):
        self.assertEqual(rows(results=[{**RESULT,'session_key':11}]),[])
        self.assertEqual(rows(results=[{**RESULT,'meeting_key':2}]),[])
        r=rows(stints=[{**s,'session_key':11} for s in STINTS],drivers=[{**DRIVER,'meeting_key':2}])[0]
        self.assertEqual(r['compounds'],{});self.assertEqual(r['unassigned_laps'],23);self.assertEqual(r['name'],'63')
    def test_zero_missing_and_unknown_tyres_are_not_invented(self):
        r=rows(results=[{**RESULT,'number_of_laps':0,'duration':None}])[0]
        self.assertEqual(r['laps'],0);self.assertEqual(r['stints'],[]);self.assertIsNone(r['best'])
        r=rows(results=[{**RESULT,'number_of_laps':None,'duration':float('nan')}])[0]
        self.assertIsNone(r['laps']);self.assertIsNone(r['unassigned_laps']);self.assertIsNone(r['best'])
        r=rows(stints=[{**STINTS[0],'compound':'TEST'}])[0]
        self.assertEqual(r['compounds'],{});self.assertEqual(r['unassigned_laps'],23)
        r=rows(results=[],laps=[scoped(driver_number=63,lap_number=1,lap_duration=None),scoped(driver_number=63,lap_number=3,lap_duration=90)])[0]
        self.assertTrue(r['recorded_only']);self.assertIsNone(r['position']);self.assertIsNone(r['best']);self.assertEqual(r['laps'],2);self.assertEqual(r['compounds'],{'WET':2})
    def test_pit_out_and_unpublished_fastest_laps_do_not_replace_classification(self):
        laps=[scoped(driver_number=63,lap_number=7,lap_duration=70,is_pit_out_lap=True),scoped(driver_number=63,lap_number=8,lap_duration=100,is_pit_out_lap=False)]
        r=rows(laps=laps)[0];self.assertEqual(r['best'],107.272);self.assertIsNone(r['best_compound']);self.assertEqual(r['stints'][1]['best'],100)
    def test_official_fallback_preserves_gap_without_inventing_personal_best(self):
        table={'tables':[['Pos.','No.','Driver','Team','Time / Gap','Laps'],['1','63','George Russell','Mercedes','1:47.272','23'],['2','10','Pierre Gasly','Alpine','+0.071s','16']]}
        r=practice_rows({},[],[],[],[],official_practice_rows({'tables':[table['tables']]}))
        self.assertAlmostEqual(r[0]['best'],107.272);self.assertIsNone(r[1]['best']);self.assertEqual(r[1]['gap_label'],'+0.071s')
        self.assertEqual(r[1]['laps'],16);self.assertEqual(r[1]['unassigned_laps'],16)
    def test_session_selection_is_unique_and_free_window_starts_30_minutes_after_end(self):
        race={'sessions':[{'name':'FP2','date':'2025-11-21T04:00Z'},{'name':'Qualifying','date':'2025-11-22T04:00Z'}]}
        before=datetime(2025,11,21,5,29,tzinfo=timezone.utc);after=datetime(2025,11,21,5,30,tzinfo=timezone.utc)
        self.assertFalse(practice_sessions(race,[session()],before)[0]['archive_ready'])
        self.assertTrue(practice_sessions(race,[session()],after)[0]['archive_ready'])
        self.assertIsNone(practice_sessions(race,[session(),{**session(),'session_key':11}],after)[0]['session_key'])
        self.assertIsNone(practice_sessions(race,[{**session(),'year':2024}],after)[0]['session_key'])
    def test_sprint_calendar_only_has_published_practice_and_cancellation_is_respected(self):
        race={'sessions':[{'name':'FP1','date':'2025-11-21T04:00Z'},{'name':'Sprint','date':'2025-11-22T04:00Z'}]}
        r=practice_sessions(race,[{**session(number=1),'is_cancelled':True}],datetime(2025,11,23,tzinfo=timezone.utc))
        self.assertEqual(len(r),1);self.assertEqual(r[0]['state'],'cancelled');self.assertFalse(r[0]['archive_ready'])

class PracticeProvider(unittest.IsolatedAsyncioTestCase):
    def provider(self,year=2025):
        provider=EnrichmentProvider(None)
        async def get(url,*args,**kw):
            if 'jolpi.ca' in url:return item(calendar(year))
            if '/sessions?' in url:return item([session(year)])
            for key,data in [('session_result',[RESULT]),('drivers',[DRIVER]),('stints',STINTS),('laps',[])]:
                if '/'+key+'?' in url:return item(data)
            return item({})
        provider.get=AsyncMock(side_effect=get);return provider
    async def test_published_data_loads_exact_session_and_session_total(self):
        p=self.provider();data=await p.f1_practice(2025,21,2)
        self.assertEqual(data['selected'],2);self.assertEqual(data['rows'][0]['laps'],23)
        self.assertEqual(len([c for c in p.get.call_args_list if 'session_key=10' in c.args[0]]),4)
        self.assertTrue(data['tyres_available']);self.assertFalse(data['error'])
    async def test_future_practice_never_calls_detail_endpoints(self):
        p=self.provider(2099);data=await p.f1_practice(2099,21,2)
        self.assertEqual(data['session']['state'],'scheduled');self.assertEqual(data['rows'],[])
        self.assertEqual(p.get.await_count,2)
    async def test_no_matching_round_cannot_show_another_race(self):
        p=self.provider();data=await p.f1_practice(2025,22,1)
        self.assertEqual(data['rows'],[]);self.assertIsNone(data['race']);self.assertEqual(p.get.await_count,1)
    async def test_live_window_uses_public_classification_without_openf1_detail_requests(self):
        p=self.provider()
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):return cls(2025,11,21,5,15,tzinfo=timezone.utc)
        with patch('custom_components.sports_hub.enrichment.datetime',Clock):data=await p.f1_practice(2025,21,2)
        self.assertTrue(data['archive_pending']);self.assertFalse(any('session_key=' in c.args[0] for c in p.get.call_args_list))
    async def test_only_approved_f1_dashboards_can_read_practice_archive(self):
        profile={'target':'racing:f1'};manager=SimpleNamespace(users={'a':{'f1':profile,'club':{'target':'soccer:1'}}},shared={})
        provider=SimpleNamespace(f1_practice=AsyncMock(return_value={'rows':[]}))
        hass=SimpleNamespace(data={DATA_KEY:manager,CONTEXT_KEY:provider})
        conn=SimpleNamespace(user=SimpleNamespace(id='a'),send_error=Mock(),send_result=Mock())
        handler=websocket_context.__wrapped__
        for msg in [{'key':'unknown','season':2025},{'key':'club','season':2025},{'key':'f1','season':2022},{'key':'f1','season':9999},{'key':'f1'}]:
            await handler(hass,conn,{'id':1,'practice':2,**msg})
        self.assertEqual(conn.send_error.call_count,5);provider.f1_practice.assert_not_called()
        await handler(hass,conn,{'id':2,'key':'f1','season':2025,'round':21,'practice':2})
        provider.f1_practice.assert_awaited_once_with(2025,21,2)
    async def test_openf1_dispatch_spaces_requests_even_when_concurrent(self):
        p=EnrichmentProvider(None);clock=[100.0];waits=[]
        async def sleep(delay):waits.append(delay);clock[0]+=delay
        with patch('custom_components.sports_hub.enrichment.time',SimpleNamespace(monotonic=lambda:clock[0])),patch('custom_components.sports_hub.enrichment.asyncio.sleep',side_effect=sleep):
            await asyncio.gather(*(p._openf1_slot() for _ in range(30)))
        self.assertTrue(all(b-a>=0.399 for a,b in zip(p.openf1_requests,list(p.openf1_requests)[1:])))
        self.assertGreaterEqual(sum(waits),61)
    async def test_array_404_means_no_published_data_not_a_provider_outage(self):
        response=Mock(status=404)
        async def chunks(size):yield b'{"detail":"No results found."}'
        response.content.iter_chunked=chunks
        context=AsyncMock();context.__aenter__.return_value=response
        p=EnrichmentProvider(SimpleNamespace(get=Mock(return_value=context)))
        result=await p.get('https://api.openf1.org/v1/session_result?session_key=10',array=True)
        self.assertEqual(result['data'],[]);self.assertFalse(result['error']);response.raise_for_status.assert_not_called()
