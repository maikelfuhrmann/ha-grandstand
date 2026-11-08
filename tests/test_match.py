"""Verify match facts, pre-match distinctions and the authenticated API boundary."""
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock
import unittest
from custom_components.sports_hub.match import normalize_match, websocket_match
from custom_components.sports_hub.catalog import LEAGUES

LEAGUE=LEAGUES['soccer:ger.1']
def payload(state='post'):
    return {'header':{'id':'123','competitions':[{'id':'123','date':'2026-11-07T14:30Z','status':{'type':{'state':state,'name':'STATUS_SCHEDULED' if state=='pre' else 'STATUS_FULL_TIME'}},'competitors':[{'team':{'id':'1','displayName':'Home'},'homeAway':'home','score':'2'},{'team':{'id':'2','displayName':'Away'},'homeAway':'away','score':'2'}]}]},'boxscore':{'teams':[{'team':{'id':'1','displayName':'Home'},'homeAway':'home','statistics':[{'name':'possessionPct','displayValue':'50.9','label':'Possession'},{'name':'passPct','displayValue':'0.8','label':'Pass Completion %'}]}]},'rosters':[{'team':{'id':'1','displayName':'Home'},'formation':'4-2-3-1','roster':[{'athlete':{'id':'5','displayName':'Player Five'},'starter':True,'jersey':'5','subbedOut':True}]}],'keyEvents':[{'id':'goal','type':{'type':'goal','text':'Goal'},'text':'Do not republish the editorial commentary','clock':{'displayValue':"23'"},'participants':[{'athlete':{'id':'5'}}],'scoringPlay':True}],'commentary':[{'text':'Do not publish'}],'odds':[{'private':'Not a match fact'}]}
class MatchModelTests(unittest.TestCase):
    def test_factual_ticker_resolves_player_ids_without_copying_commentary(self):
        d=normalize_match(payload(),LEAGUE,'123');self.assertEqual(d['timeline'][0]['participants'],['Player Five']);self.assertTrue(d['timeline'][0]['scoring']);self.assertNotIn('Do not',str(d));self.assertNotIn('odds',d)
    def test_lineup_uses_explicit_starter_and_formation(self):
        d=normalize_match(payload(),LEAGUE,'123');self.assertEqual(d['lineups'][0]['formation'],'4-2-3-1');self.assertTrue(d['lineups'][0]['has_starters']);self.assertTrue(d['lineups'][0]['players'][0]['out'])
    def test_pre_match_totals_are_never_labelled_match_statistics(self):
        d=normalize_match(payload('pre'),LEAGUE,'123');self.assertEqual(d['stats_scope'],'season');self.assertEqual(d['player_tables'],[])
    def test_percentage_units_are_preserved(self):
        stats=normalize_match(payload(),LEAGUE,'123')['teams'][0]['stats'];self.assertEqual(stats[0]['display'],'50.9%');self.assertEqual(stats[1]['display'],'80%')
    def test_empty_lineup_is_not_inferred_from_club_roster(self):
        d=normalize_match({'rosters':[{'team':{'id':'1'}}]},LEAGUE,'123');self.assertFalse(d['lineups'][0]['has_starters']);self.assertEqual(d['lineups'][0]['players'],[])
    def test_nfl_drives_are_flattened_and_duplicate_plays_removed(self):
        play={'id':'x','type':{'text':'Rush'},'sequenceNumber':'3'}
        d=normalize_match({'drives':{'previous':[{'plays':[play]}],'current':{'plays':[play]}}},LEAGUES['football:nfl'],'123');self.assertEqual(len(d['timeline']),1);self.assertEqual(d['timeline_kind'],'plays')
class MatchAPITests(unittest.IsolatedAsyncioTestCase):
    async def test_auth_validation_and_cache_expiry_do_not_slide_forever(self):
        now=datetime.now(timezone.utc);retrieved=now-timedelta(minutes=5)
        item={'data':payload(),'updated_at':retrieved.isoformat(),'error':False,'expires':now}
        provider=SimpleNamespace(cache={},get=AsyncMock(return_value=item));hass=SimpleNamespace(data={'sports_hub':{'entry':{}},'sports_hub_context':provider});conn=SimpleNamespace(user=None,send_error=Mock(),send_result=Mock());msg={'id':1,'league_id':'soccer:ger.1','event_id':'123'}
        await websocket_match.__wrapped__(hass,conn,msg);provider.get.assert_not_awaited()
        conn.user=object();await websocket_match.__wrapped__(hass,conn,{**msg,'event_id':'../../secret'});provider.get.assert_not_awaited()
        await websocket_match.__wrapped__(hass,conn,msg);self.assertEqual(item['expires'],retrieved+timedelta(minutes=15));self.assertFalse(conn.send_result.call_args.args[1]['stale'])
