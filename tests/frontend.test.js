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

import {searchMatches,isFavorite} from '../custom_components/sports_hub/frontend/model.js';
import {colorValue,contrastColor,profileFromParticipant,profileFromLeague,dashboardEvents,discoverProfiles,approvedProfile} from '../custom_components/sports_hub/frontend/dashboards.js';
import {words,languageCode} from '../custom_components/sports_hub/frontend/i18n.js';
test('FC Bayern and localized names match provider names',()=>{assert.ok(searchMatches(['Bayern Munich','Bayern'],'FC Bayern München'));assert.ok(searchMatches(['1. FC Cologne'],'FC Köln'));assert.equal(searchMatches(['Borussia Dortmund'],'FC Bayern'),false);assert.doesNotThrow(()=>filterEvents([base],{search:undefined}));});
test('personal dashboard keeps cross-competition matches and excludes other clubs',()=>{const profile={kind:'team',target:'soccer:123'};assert.equal(dashboardEvents([base,{...base,id:'cup',league_id:'soccer:ger.dfb_pokal'},{...base,id:'other',participants:[]}],profile).length,2);assert.equal(dashboardEvents([base],{kind:'league',target:'soccer:ger.dfb_pokal'}).length,0);});
test('league favorites match all events in their competition',()=>{assert.ok(isFavorite(base,['league:soccer:ger.1']));assert.equal(isFavorite(base,['league:football:nfl']),false);});
test('search discovery is independent of match date and deduplicates clubs',()=>{const data={leagues:[{id:'soccer:ger.1',name:'Bundesliga',sport:'soccer'}],events:[base,{...base,id:'cup',date:'2026-11-01',league_id:'soccer:ger.dfb_pokal'}]};assert.equal(discoverProfiles(data,'Frankfurt').length,1);assert.equal(discoverProfiles(data,'Bundesliga')[0].kind,'league');});
test('branding sanitizes colors and uses accessible button text',()=>{assert.equal(colorValue('dc052d'),'#dc052d');assert.equal(colorValue('red;display:none'),'#315bd6');assert.equal(contrastColor('#ffffff'),'#08101b');assert.equal(contrastColor('#000000'),'#ffffff');assert.equal(contrastColor('#dc052d'),'#ffffff');assert.equal(profileFromLeague({id:'soccer:ger.1',name:'Bundesliga',sport:'soccer'}).color,'#d20515');});
test('a favorite alone cannot become an approved dashboard',()=>{assert.equal(approvedProfile([],'team:soccer:123'),null);});
test('all six languages include complete dashboard and sports strings',()=>{for(const language of ['en','de','es','fr','it','nl']){assert.equal(languageCode(language+'-XX'),language);for(const key of Object.keys(words.en)){assert.ok(words[language][key],`${language}:${key}`);}assert.equal(Object.keys(words[language].sports).length,10);}assert.equal(languageCode('unknown'),'en');assert.equal(languageCode('__proto__'),'en');});

import {mergeProfileEvents,clubForm,dossierTabs} from '../custom_components/sports_hub/frontend/dossier-model.js';
import {f1CardConfig} from '../custom_components/sports_hub/frontend/f1-dossier.js';
import {dossierMethods} from '../custom_components/sports_hub/frontend/dossier.js';
import '../custom_components/sports_hub/frontend/dossier-i18n.js';
test('season fixtures merge with newest live scores and stay scoped to selected club',()=>{
  const profile={kind:'team',target:'soccer:123'},season={...base,id:'new',date:'2027-05-01',updated_at:'2026-11-08T10:00:00Z'};
  const merged=mergeProfileEvents([{...base,updated_at:'2026-11-08T12:00:00Z'}],[{...base,updated_at:'2026-11-08T09:00:00Z'},season,{...season,id:'other',participants:[]}],profile);
  assert.equal(merged.length,2);assert.equal(merged[0].updated_at,'2026-11-08T12:00:00Z');assert.equal(merged[1].id,'new');
});
test('form uses penalty winner, excludes missing scores and stale results',()=>{
  const event={...base,format:'match',state:'finished',date:'2026-11-08',participants:[{key:'a',score:'1',winner:true},{key:'b',score:'1',winner:false}]};
  assert.equal(clubForm([event,{...event,stale:true},{...event,participants:[{key:'a',score:null},{key:'b',score:0}]}],'a').length,1);assert.equal(clubForm([event],'a')[0].result,'W');
});
test('F1 modules use runtime-discovered entry and public timing context',()=>{
  const config=f1CardConfig('Timing',[{type:'timing'}],'runtime-entry',true);assert.equal(config.f1_entry_id,'runtime-entry');assert.equal(config.context.selection.source,'live');assert.ok(dossierTabs({target:'racing:f1'}).includes('raceControl'));
});
test('spoiler protection hides standings, headlines and form content',()=>{
  const panel={hideScores:true,t:words.en,_spoilerNotice:dossierMethods._spoilerNotice};
  assert.equal(dossierMethods._tables.call(panel,{tables:[{}]},{}),dossierMethods._spoilerNotice.call(panel));
  assert.equal(dossierMethods._news.call(panel,{news:{articles:[{title:'Spoiler'}]}}),dossierMethods._spoilerNotice.call(panel));
});
