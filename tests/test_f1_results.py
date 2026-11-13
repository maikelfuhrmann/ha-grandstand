"""Published classifications must remain scoped and distinct from qualifying."""
from datetime import datetime, timezone
import unittest
from custom_components.sports_hub.f1_results import parse_result_page,result_root,result_rows,select_weekend,jolpica_qualifying

def page(kind='qualifying',position='2'):
    headers=['Pos.','No.','Driver','Team']+(['Q1','Q2','Q3'] if kind=='qualifying' else ['Time'])
    def row(pos,num):return [pos,num,'<span class="max-lg:hidden">Alex</span> <span class="max-md:hidden">Driver</span><span class="md:hidden">DRV</span>','Example']+(['1:20.000','1:19.000',''] if kind=='qualifying' else ['1:19.000'])
    return '<script>ignore me</script><table><tr>'+''.join('<th>'+h+'</th>' for h in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+c+'</td>' for c in cells)+'</tr>' for cells in [row('1','1'),row(position,'63')])+'</table><p>Note - grid penalty.</p>'

class F1ResultsTests(unittest.TestCase):
    def test_visible_table_names_exclude_responsive_acronym_and_missing_times_stay_empty(self):
        parsed=parse_result_page(page());rows=result_rows(parsed,'qualifying')
        self.assertEqual(rows[1]['name'],'Alex Driver');self.assertEqual(rows[1]['q3'],'');self.assertEqual(rows[1]['q2'],'1:19.000');self.assertEqual(parsed['notes'],['Note - grid penalty.'])
    def test_duplicate_slots_fail_closed_and_pit_lane_is_explicit(self):
        self.assertEqual(result_rows(parse_result_page(page(position='1')),'qualifying'),[])
        self.assertEqual(result_rows(parse_result_page(page('grid','PL')),'grid')[1]['position'],0)
        self.assertIsNone(result_rows(parse_result_page(page('grid','NC')),'grid')[1]['position'])
        self.assertEqual(result_rows(parse_result_page(page()),'grid'),[])
    def test_race_path_must_match_exact_season_and_circuit(self):
        data=parse_result_page('<a href="/en/results/2026/races/1299/brazil/race-result">Brazil</a><a href="https://evil.example/en/results/2026/races/1/brazil/race-result">Bad</a>')
        self.assertEqual(result_root(data,'2026','interlagos'),'https://www.formula1.com/en/results/2026/races/1299/brazil')
        self.assertIsNone(result_root(data,'2025','interlagos'));self.assertIsNone(result_root(data,'2026','unknown'))
    def test_weekend_advances_after_finished_main_race_but_not_qualifying_or_sprint(self):
        races=[{'round':'1','date':'2026-11-08T17:00:00Z'},{'round':'2','date':'2026-11-22T06:00:00Z'}]
        now=datetime(2026,11,8,19,tzinfo=timezone.utc)
        def live(label,status='finished',start='2026-11-08T17:00:00Z'):
            return {'current_session':{'state':label,'attributes':{'name':label,'start':start,'live_status':status},'updated_at':now.isoformat()}}
        self.assertEqual(select_weekend(races,now,live('Race'))['round'],'2')
        for label in ('Sprint','Qualifying','Sprint Qualifying','Practice 3'):
            self.assertEqual(select_weekend(races,now,live(label))['round'],'1')
        self.assertEqual(select_weekend(races,now,live('Race',start='2026-10-25T17:00:00Z'))['round'],'1')
        self.assertEqual(select_weekend(races,now,completed={'season':'2026','round':'1'})['round'],'2')
        self.assertEqual(select_weekend(races,now,completed={'season':'2025','round':'1'})['round'],'1')
    def test_expired_schedule_advances_but_a_fresh_suspended_race_is_retained(self):
        races=[{'round':'1','date':'2026-11-08T17:00:00Z'},{'round':'2','date':'2026-11-22T06:00:00Z'}]
        now=datetime(2026,11,8,23,tzinfo=timezone.utc)
        live={'current_session':{'state':'Race','attributes':{'start':races[0]['date'],'live_status':'suspended'},'updated_at':now.isoformat()}}
        self.assertEqual(select_weekend(races,now)['round'],'2')
        self.assertEqual(select_weekend(races,now,live)['round'],'1')
        live['current_session']['updated_at']='2026-11-08T16:00:00Z'
        self.assertEqual(select_weekend(races,now,live)['round'],'2')
        self.assertIsNone(select_weekend(races,datetime(2026,12,8,tzinfo=timezone.utc)))
        self.assertIsNone(select_weekend([{'date':'bad'}],now))
    def test_status_from_different_session_cannot_finish_current_race(self):
        race={'round':'1','date':'2026-11-08T17:00:00Z'}
        live={'current_session':{'state':'Race','attributes':{'start':race['date'],'live_status':'Started'}},
              'session_status':{'state':'finished','attributes':{'start':'2026-11-07T17:00:00Z'}}}
        self.assertEqual(select_weekend([race],datetime(2026,11,8,18,tzinfo=timezone.utc),live),race)
    def test_jolpica_results_from_a_different_weekend_are_rejected(self):
        data={'MRData':{'RaceTable':{'Races':[{'season':'2026','round':'19','QualifyingResults':[{'position':'1'}]}]}}}
        self.assertEqual(jolpica_qualifying(data,'2026','20'),[])
