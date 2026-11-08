"""Behavioral parser and refresh tests using synthetic provider fixtures."""
import copy
from datetime import datetime, timedelta, timezone
import unittest

from custom_components.sports_hub.catalog import LEAGUES, selected_leagues
from custom_components.sports_hub.model import normalize_scoreboard, event_state, refresh_seconds, safe_url, parse_time, league_branding

START=datetime(2026,11,8,tzinfo=timezone.utc)
END=START+timedelta(days=1)

def fixture(sport='soccer', state='in'):
    return {'events':[{'id':'100','name':'A vs B','date':'2026-11-08T12:00:00Z','competitions':[{'id':'101','date':'2026-11-08T12:00:00Z','status':{'type':{'state':state}},'competitors':[{'id':'1','homeAway':'away','team':{'id':'1','uid':f's:{sport}~t:1','displayName':'A'},'score':'2'},{'id':'2','homeAway':'home','team':{'id':'2','uid':f's:{sport}~t:2','displayName':'B'},'score':{'displayValue':'0'}}]}]}]}

class ModelTests(unittest.TestCase):
    def parse(self,data,league='soccer:ger.1'):
        return normalize_scoreboard(data,LEAGUES[league],START,END)

    def test_home_away_and_score_formats(self):
        result=self.parse(fixture())[0]
        self.assertEqual([p['name'] for p in result['participants']],['B','A'])
        self.assertEqual([p['score'] for p in result['participants']],['0','2'])

    def test_provider_branding_preserves_valid_colors_and_logos(self):
        data=fixture();team=data['events'][0]['competitions'][0]['competitors'][0]['team']
        team.update({'color':'DC052D','alternateColor':'ffffff','logo':'https://example.com/team.png'})
        participant=self.parse(data)[0]['participants'][1]
        self.assertEqual(participant['color'],'#dc052d')
        self.assertEqual(participant['alternate_color'],'#ffffff')
        self.assertEqual(participant['logo'],'https://example.com/team.png')
        self.assertEqual(league_branding({'leagues':[{'logos':[{'href':'javascript:bad'},{'href':'https://example.com/league.png'}]}]})['logo'],'https://example.com/league.png')

    def test_missing_scores_are_not_zero(self):
        data=fixture();del data['events'][0]['competitions'][0]['competitors'][0]['score']
        self.assertIsNone(self.parse(data)[0]['participants'][1]['score'])

    def test_unique_id_keeps_all_tennis_matches(self):
        data=fixture();event=data['events'][0];comp=event.pop('competitions')[0]
        other=copy.deepcopy(comp);other['id']='102'
        event['groupings']=[{'competitions':[comp,other]},{'competitions':[comp]}]
        self.assertEqual(len(self.parse(data,'tennis:atp')),2)

    def test_tournament_end_does_not_extend_old_match(self):
        data=fixture();data['events'][0]['endDate']='2026-11-10T00:00:00Z';data['events'][0]['competitions'][0]['date']='2026-11-01T12:00:00Z'
        self.assertEqual(self.parse(data,'tennis:atp'),[])

    def test_race_sessions_remain_separate(self):
        data=fixture();comp=copy.deepcopy(data['events'][0]['competitions'][0]);comp['id']='race';data['events'][0]['competitions'].append(comp)
        self.assertEqual(len(self.parse(data,'racing:f1')),2)

    def test_golf_leaderboard_spans_dates(self):
        data=fixture();data['events'][0]['endDate']='2026-11-09T00:00:00Z';data['events'][0]['competitions'][0]['date']='2026-11-06T12:00:00Z'
        self.assertEqual(len(self.parse(data,'golf:pga')),1)

    def test_nba_and_wnba_identity_do_not_collide(self):
        data=fixture('basketball');c=data['events'][0]['competitions'][0]['competitors'][0]
        c['team']['uid']='s:40~l:46~t:1';nba=self.parse(data,'basketball:nba')[0]['participants'][1]['key']
        c['team']['uid']='s:40~l:59~t:1';wnba=self.parse(data,'basketball:wnba')[0]['participants'][1]['key']
        self.assertNotEqual(nba,wnba)

    def test_missing_or_invalid_dates_are_skipped(self):
        data=fixture();data['events'][0]['competitions'][0]['date']='invalid';self.assertEqual(self.parse(data),[])
        self.assertIsNone(parse_time('2026-11-08T12:00:00'))

    def test_missing_events_is_error_but_empty_is_valid(self):
        with self.assertRaises(ValueError):self.parse({'error':'down'})
        self.assertEqual(self.parse({'events':[]}),[])

    def test_delay_cancellation_and_play_complete_are_not_live_or_final(self):
        for name in ['STATUS_DELAYED','STATUS_SUSPENDED','STATUS_CANCELED','STATUS_PLAY_COMPLETE']:
            self.assertEqual(event_state({'type':{'name':name,'state':'in','completed':True}}),'interrupted')

    def test_refresh_and_backoff_are_bounded(self):
        self.assertEqual(refresh_seconds([{'state':'live'}],START),30)
        self.assertEqual(refresh_seconds([],START),900)
        self.assertEqual(refresh_seconds([],START,1),60)
        self.assertEqual(refresh_seconds([],START,100),900)

    def test_known_leagues_only(self):
        self.assertEqual(selected_leagues(['soccer:ger.1','evil','soccer:ger.1']),['soccer:ger.1'])

    def test_external_links_need_https(self):
        for value in ['javascript:alert(1)','http://example.com','https://a:b@example.com','//example.com']:
            self.assertEqual(safe_url(value),'')

if __name__=='__main__':unittest.main()
