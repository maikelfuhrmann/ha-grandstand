import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml, safeUrl, dateKey, shiftDate, filterEvents, scoreDisplay, isFreshLive} from '../custom_components/sports_hub/frontend/model.js';

const now=Date.parse('2026-11-08T15:00:00Z');
const base={id:'x',league_id:'soccer:ger.1',sport:'soccer',league:'Bundesliga',name:'A vs B',date:'2026-11-08T14:30:00Z',state:'live',updated_at:'2026-11-08T14:59:30Z',stale:false,participants:[{key:'soccer:123',name:'Eintracht Frankfurt',score:'2',winner:true,linescores:[]},{key:'soccer:456',name:'Opponent',score:'1',linescores:[]}],format:'match'};
test('late US games use the configured HA timezone',()=>{assert.equal(dateKey('2026-11-08T01:00:00Z','America/New_York'),'2026-11-07');assert.equal(dateKey('2026-11-08T01:00:00Z','Europe/Berlin'),'2026-11-08');});
test('date navigation crosses month and year boundaries',()=>{assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.equal(shiftDate('2026-11-01',-1),'2026-10-31');});
test('stale live scores leave the live view',()=>{assert.equal(isFreshLive(base,now),true);assert.equal(isFreshLive(base,now+120000),false);assert.equal(filterEvents([{...base,stale:true}],{view:'live',now}).length,0);});
test('favorites match across competitions using competitor identity',()=>{assert.equal(filterEvents([base,{...base,id:'y',league_id:'soccer:uefa.europa'}],{view:'favorites',favorites:['soccer:123'],now}).length,2);});
test('sport, league, search and local date filters compose',()=>{assert.equal(filterEvents([base],{sport:'soccer',league:'soccer:ger.1',search:'frankfurt',date:'2026-11-08',now}).length,1);assert.equal(filterEvents([base],{sport:'basketball',now}).length,0);});
test('results and schedule cannot mix states',()=>{assert.equal(filterEvents([base,{...base,id:'done',state:'finished'},{...base,id:'later',state:'scheduled'}],{view:'results',now})[0].id,'done');assert.equal(filterEvents([base],{view:'schedule',now}).length,0);});
test('missing or future scores never appear as 0:0',()=>{assert.equal(scoreDisplay({score:null},base,false),'–');assert.equal(scoreDisplay({score:'0'},{...base,state:'scheduled'},false),'–');assert.equal(scoreDisplay({score:'0'},base,false),'0');});
test('spoiler protection hides scores and tennis set details',()=>{assert.equal(scoreDisplay({score:'123'},base,true),'•');assert.equal(scoreDisplay({score:null,linescores:['6','4']},{...base,sport:'tennis'},true),'•');});
test('UFC draws are not labelled as two losses',()=>{assert.equal(scoreDisplay({winner:false},{...base,sport:'mma',state:'finished',participants:[{winner:false},{winner:false}]},false),'–');});
test('unsafe provider markup and links are escaped or rejected',()=>{assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('https://user:pass@example.com'),'');});
test('multi-day golf events span dates but tennis matches do not',()=>{const golf={...base,format:'leaderboard',date:'2026-11-06T12:00:00Z',end_date:'2026-11-09T12:00:00Z'};assert.equal(filterEvents([golf],{date:'2026-11-08',now}).length,1);assert.equal(filterEvents([{...golf,format:'match'}],{date:'2026-11-08',now}).length,0);});
