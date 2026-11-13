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

import {matchReference,matchMethods} from '../custom_components/sports_hub/frontend/match-center.js';
import '../custom_components/sports_hub/frontend/match-i18n.js';
test('match center never mistakes a tournament ID for a tennis or MMA match',()=>{
 const event={id:'soccer:ger.1:123:123',sport:'soccer',format:'match',league_id:'soccer:ger.1'};
 assert.equal(matchReference(event).event_id,'123');assert.equal(matchReference({...event,sport:'tennis'}),null);assert.equal(matchReference({...event,sport:'mma'}),null);assert.equal(matchReference({...event,id:'soccer:ger.1:../../bad:123'}),null);
});
test('pre-match statistics visibly identify season totals',()=>{
 const panel={t:words.en};const html=matchMethods._matchStats.call(panel,{stats_scope:'season',teams:[{team:{name:'A'},stats:[{key:'totalGoals',label:'Goals',display:'15',value:15}]},{team:{name:'B'},stats:[{key:'totalGoals',label:'Goals',display:'14',value:14}]}]});
 assert.ok(html.includes(words.en.preMatchStats));assert.ok(html.includes('15'));
});

import {soccerFormation,startingGridModel} from '../custom_components/sports_hub/frontend/lineup-layout.js';
const lineup=(formation,roles)=>({formation,players:roles.map((position,i)=>({id:String(i+1),name:'Player '+(i+1),position,starter:true,number:String(i+1)}))});
test('football pitch respects 4-2-3-1 roles, left/right orientation and goalkeeper',()=>{
 const rows=soccerFormation(lineup('4-2-3-1',['G','CD-L','CD-R','LB','RB','AM','LM','RM','F','AM-L','AM-R']));
 assert.deepEqual(rows.map(r=>r.map(p=>p.position)),[['F'],['AM-L','AM','AM-R'],['LM','RM'],['LB','CD-L','CD-R','RB'],['G']]);
});
test('three-five-two keeps wingbacks in midfield and does not place substitutes on the pitch',()=>{
 const l=lineup('3-5-2',['G','CD','CD-L','CD-R','CM-L','CM-R','AM','LM','RM','CF-L','CF-R']);l.players.push({id:'bench',position:'G',starter:false});
 const rows=soccerFormation(l);assert.deepEqual(rows.map(r=>r.length),[2,5,3,1]);assert.deepEqual(rows[1].map(p=>p.position),['LM','CM-L','AM','CM-R','RM']);
});
test('missing, duplicate, incomplete and unsupported formations stay as a list',()=>{
 const l=lineup('4-4-2',['G','LB','CD','CD','RB','LM','CM','CM','RM','CF','CF']);
 assert.equal(soccerFormation({...l,formation:''}),null);assert.equal(soccerFormation({...l,formation:'4-4-4'}),null);assert.equal(soccerFormation({...l,players:l.players.slice(0,10)}),null);
 assert.equal(soccerFormation({...l,players:[...l.players.slice(0,10),l.players[1]]}),null);l.players[3].position='unknown';assert.equal(soccerFormation(l),null);
});
test('grid preserves published gaps, separates pit lane and never assigns missing positions',()=>{
 const rows=[{racing_number:'1',grid_position:3},{racing_number:'2',grid_position:1},{racing_number:'3',grid_position:0},{racing_number:'4',grid_position:null},{racing_number:'5',grid_position:''},{racing_number:'6',grid_position:4},{racing_number:'7',grid_position:4},{racing_number:'2',grid_position:9}];
 const m=startingGridModel({status:'ready',data:{status:'ready',payload:{attributes:{status:'confirmed',grid:rows}}}});
 assert.deepEqual(m.grid.map(r=>r.position),[1,3]);assert.equal(m.pit[0].id,'3');assert.equal(m.unassigned.length,4);assert.equal(m.status,'confirmed');
});
test('grid respects source spoiler blocking and marks interrupted connections stale',()=>{
 const packet={status:'ready',payload:{attributes:{grid:[{racing_number:'1',grid_position:1}]}}};
 assert.equal(startingGridModel({status:'ready',data:{...packet,status:'blocked'}}).grid.length,0);
 assert.equal(startingGridModel({status:'disconnected',data:packet}).stale,true);
 assert.equal(startingGridModel({status:'ready',data:{...packet,status:'unavailable'}}).grid.length,0);
});

import {f1CarAsset,f1WeekendModel} from '../custom_components/sports_hub/frontend/f1-results-model.js';
const weekend={season:'2026',meeting:'Test GP',race_date:'2026-11-08T17:00:00Z',qualifying:{source:'Jolpica',rows:[{number:'63',name:'Driver',team:'Mercedes',position:2,q1:'1:20.000',q2:'1:19.000',q3:'1:18.000'}]},grid:{source:'Formula1.com',rows:[{number:'63',name:'Driver',team:'Mercedes',position:7,time:'1:18.000'}]}};
test('published grid is distinct from qualifying and exposes penalty movement',()=>{
 const m=f1WeekendModel(null,weekend,false);assert.equal(m.grid[0].position,7);assert.equal(m.qualifying[0].position,2);assert.equal(m.grid[0].delta,5);assert.equal(m.gridByNumber.get('63'),7);assert.equal(m.status,'published');assert.equal(m.grid[0].time,'1:18.000');
});
test('public fallback never reveals rows while protected source blocks or loads',()=>{
 for(const resource of [null,{status:'loading'},{status:'ready',data:{status:'blocked'}}]){const m=f1WeekendModel(resource,weekend,true);assert.equal(m.grid.length,0);assert.equal(m.qualifying.length,0);}
 const m=f1WeekendModel({status:'error'},weekend,true);assert.equal(m.grid.length,1);
});
test('qualifying-only grid stays provisional and expires after race weekend',()=>{
 const w={...weekend,grid:{rows:[]}};const before=f1WeekendModel(null,w,false,Date.parse('2026-11-08T12:00Z'));
 assert.equal(before.status,'provisional');assert.equal(before.grid[0].position,2);assert.equal(before.grid[0].time,'1:18.000');
 const after=f1WeekendModel(null,w,false,Date.parse('2026-11-10T12:00Z'));assert.equal(after.grid.length,0);assert.equal(after.qualifying.length,1);
 assert.equal(f1WeekendModel(null,{},false).loading,false);
});
test('car assets are season-scoped and do not confuse the two Red Bull teams',()=>{
 assert.ok(f1CarAsset('Red Bull Racing','2026').url.includes('/redbullracing/'));
 assert.ok(f1CarAsset('RB F1 Team',2026).url.includes('/racingbulls/'));
 assert.ok(f1CarAsset('Haas F1 Team',2026).url.includes('/haasf1team/'));
 assert.equal(f1CarAsset('McLaren',2027),null);assert.equal(f1CarAsset('Unknown',2026),null);
});

import {f1DriverAsset,f1HeadshotAsset} from '../custom_components/sports_hub/frontend/f1-results-model.js';
test('F1 portraits match verified people and season, including localized name accents',()=>{
 assert.match(f1DriverAsset('Lando Norris',2026).url,/mclaren\/lannor01/);
 assert.match(f1DriverAsset('Rafael Câmara',2026).url,/rafcam01/);
 assert.match(f1DriverAsset('Andrea Kimi ANTONELLI',2026).url,/andant01/);
 assert.match(f1DriverAsset('Nico Hülkenberg',2026).url,/nichul01/);
 assert.equal(f1DriverAsset('Lando Norris',2025),null);
 assert.equal(f1DriverAsset('Unknown Driver',2026),null);
 assert.equal(f1DriverAsset('1',2026),null);
});

test('headshots prefer matching official season and identity, otherwise use a portrait crop',()=>{
 const url='https://media.formula1.com/image/upload/common/f1/2026/mclaren/lannor01/headshot.webp';
 const ds=[{name:'Lando NORRIS',headshot_large:url}];
 assert.deepEqual(f1HeadshotAsset('Lando Norris',2026,ds),{url,cropped:false});
 assert.equal(f1HeadshotAsset('Lando Norris',2026,[]).cropped,true);
 assert.equal(f1HeadshotAsset('Lando Norris',2026,[{name:'Lando Norris',headshot_large:'javascript:alert(1)'}]).cropped,true);
 assert.equal(f1HeadshotAsset('Lando Norris',2026,[{name:'Lando Norris',headshot_large:url.replace('2026','2025')}]).cropped,true);
 assert.equal(f1HeadshotAsset('Lando Norris',2026,[{name:'Lando Norris',headshot_large:url.replace('media.formula1.com','example.com')}]).cropped,true);
 assert.equal(f1HeadshotAsset('Oscar Piastri',2026,ds).cropped,true);
 assert.equal(f1HeadshotAsset('Unknown',2026,ds),null);
 assert.equal(f1HeadshotAsset('Lando Norris',2025,ds),null);
});

import {radarUrl} from '../custom_components/sports_hub/frontend/radar.js';
test('radar is centered on the event coordinates and selects observed radar',()=>{
 const u=new URL(radarUrl({latitude:-23.7036,longitude:-46.6997},'de'));
 assert.equal(u.hostname,'embed.windy.com');assert.equal(u.searchParams.get('overlay'),'radar');assert.equal(u.searchParams.get('product'),'radar');assert.equal(u.searchParams.get('lat'),'-23.7036');assert.equal(u.searchParams.get('lon'),'-46.6997');assert.equal(u.searchParams.get('lang'),'de');
});
test('radar cannot silently use zero or home coordinates for missing venue data',()=>{
 for(const p of [null,{}, {latitude:null,longitude:0},{latitude:'',longitude:0},{latitude:true,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:Infinity}])assert.equal(radarUrl(p),'');
 assert.ok(radarUrl({latitude:0,longitude:0}));
});

import {personalSections,monthDays,moveMonth} from '../custom_components/sports_hub/frontend/personal-model.js';
import {personalMethods} from '../custom_components/sports_hub/frontend/personal.js';
import '../custom_components/sports_hub/frontend/personal-i18n.js';
test('personal matchday groups fresh live, upcoming and genuine results',()=>{
 const rows=[base,{...base,id:'past',state:'finished'},{...base,id:'calendar',state:'finished',calendar_only:true},{...base,id:'future',state:'scheduled',date:'2026-11-09T15:00:00Z'}];
 const groups=personalSections(rows,now,'Europe/Berlin');assert.equal(groups.live.length,1);assert.equal(groups.results.length,1);assert.equal(groups.upcoming.length,1);
});
test('calendar has complete Monday-first leap month and year navigation',()=>{
 const days=monthDays('2028-02');assert.equal(days.length,42);assert.equal(days[0],'2028-01-31');assert.ok(days.includes('2028-02-29'));assert.equal(moveMonth('2026-12',1),'2027-01');assert.equal(moveMonth('2026-01',-1),'2025-12');
});
test('offline preference mutation is retained for retry',async()=>{
 let fail=true,calls=0;const panel={...personalMethods,_hass:{user:{id:'alice'},callWS:async()=>{calls++;if(fail)throw Error('offline');return {favorites:{},settings:{hide_scores:false}};}},_preferenceQueue:[{action:'favorite',key:'league:racing:f1',enabled:true}],_render(){},_applyPreferences(){}};
 await panel._flushPreferences();assert.equal(panel._preferenceQueue.length,1);assert.equal(panel._preferenceError,true);fail=false;await panel._flushPreferences();assert.equal(panel._preferenceQueue.length,0);assert.equal(panel._preferenceError,false);assert.equal(calls,2);
});
test('a response from a previous HA user never applies to another user',async()=>{
 let finish,applied=false;const panel={...personalMethods,_hass:{user:{id:'alice'},callWS:()=>new Promise(resolve=>{finish=resolve;})},_preferenceQueue:[{action:'favorite',key:'league:racing:f1',enabled:true}],_render(){},_applyPreferences(){applied=true;}};
 const pending=panel._flushPreferences();panel._hass.user={id:'bob'};finish({favorites:{},settings:{}});await pending;assert.equal(applied,false);
});
test('personal UI strings are available in every supported language',()=>{
 for(const lang of ['en','de','es','fr','it','nl'])for(const key of ['myday','calendar','personalSettings','quietHours','calendarSharedNotice','syncError'])assert.equal(typeof words[lang][key],'string');
});

test('approved clubs remain searchable outside the scoreboard window without merging namesakes',()=>{
 const men={key:'team:soccer:men',target:'soccer:men',kind:'team',name:'Bayern Munich',league_id:'soccer:ger.1',color:'#dc052d'};
 const women={...men,key:'team:soccer:women',target:'soccer:women',league_id:'soccer:uefa.wchampions'};
 const rows=discoverProfiles({leagues:[],events:[]},'Bayern',[men,women,men]);
 assert.equal(rows.length,2);assert.ok(rows.some(p=>p.target==='soccer:men'));assert.ok(rows.some(p=>p.target==='soccer:women'));
 assert.equal(discoverProfiles({leagues:[],events:[]},'Frankfurt',[men]).length,0);
});


test('my matchday includes the race after six earlier mixed-sport fixtures',()=>{
 const dates=['2026-11-20T00:30Z','2026-11-20T04:00Z','2026-11-20T19:30Z','2026-11-21T00:30Z','2026-11-21T04:00Z','2026-11-21T14:30Z','2026-11-22T04:00Z'];
 const names=['FP1','FP2','Bayern','FP3','Qualifying','Frankfurt','Las Vegas Race'];
 const rows=dates.map((date,i)=>({...base,id:`fixture-${i}`,name:names[i],date,state:'scheduled'}));
 const panel={...personalMethods,now:Date.parse('2026-11-13T08:00Z'),zone:'Europe/Berlin',t:words.de,favorites:['league:racing:f1'],dashboards:[],_ensurePersonal(){},_personalEvents:()=>rows,_personalProfiles:()=>[],_personalStatus:()=>'',_format:()=>'',_game:e=>`<article data-test-event="${e.id}">${e.name}</article>`};
 const html=panel._myDay();assert.match(html,/Las Vegas Race/);assert.match(html,/class="count">7</);assert.doesNotMatch(html,/data-action="personal-more"/);
});
test('every matchday event remains reachable beyond the initial page, independently per section',()=>{
 const events=Array.from({length:42},(_,i)=>({id:`event-${i}`}));
 const panel={...personalMethods,t:words.de,_game:e=>`<article data-test-event="${e.id}"></article>`};
 let html=panel._personalBlock('upcoming','Next',events);
 assert.match(html,/12 \/ 42/);assert.match(html,/Mehr anzeigen · Next \(30\)/);assert.equal((html.match(/<article/g)||[]).length,12);
 for(const count of [24,36,42]){
  panel._showMorePersonal('upcoming');html=panel._personalBlock('upcoming','Next',events);
  assert.equal((html.match(/<article/g)||[]).length,count);
  assert.equal(new Set([...html.matchAll(/data-test-event="([^"]+)"/g)].map(m=>m[1])).size,count);
  assert.equal(panel._personalBlock('upcoming','Next',events),html,'a refresh must not collapse expanded events');
 }
 assert.match(html,/event-41/);assert.doesNotMatch(html,/data-action="personal-more"/);
 assert.equal((panel._personalBlock('results','Results',events).match(/<article/g)||[]).length,12);
 assert.equal(panel._personalBlock('live','Live',[]),'');
});

import {f1DossierMethods} from '../custom_components/sports_hub/frontend/f1-dossier.js';
import {f1ArchiveMethods} from '../custom_components/sports_hub/frontend/f1-archive.js';
const f1Profile={key:'league:racing:f1',name:'Formula 1',target:'racing:f1'};
function f1PanelFixture(){return {...dossierMethods,...f1DossierMethods,...f1ArchiveMethods,t:words.en,now:Date.parse('2026-11-13T12:00Z'),view:'results',activeDashboard:f1Profile,_format:s=>s,_sourceSummary:()=>'',_render:()=>{},_hass:{user:{id:'a'}},isConnected:true};}
test('results show race classification first, qualifying below, two archive dropdowns and no starting grid',()=>{
 const p=f1PanelFixture(),f1={season:'2026',last_completed:{season:'2026',round:'1'}};p._ensureF1Archive=()=>{};
 p._f1Archives={'league:racing:f1:2026:1':{data:{season:'2026',round:'1',race:{name:'Brazil GP',date:'2026-11-08',circuit:'Interlagos'},calendar:[{round:'1',name:'Brazil GP'}],results:[{rank:1,name:'Race winner'}],qualifying:[{position:1,name:'Pole sitter'}]}}};
 const html=p._f1Dossier(f1Profile,{f1,bridge:{available:true,cards_enabled:true}});
 assert.ok(html.indexOf('Race results')<html.indexOf('Race winner'));assert.ok(html.indexOf('Race winner')<html.indexOf('Pole sitter'));
 assert.equal((html.match(/<select /g)||[]).length,2);assert.ok(!html.includes('data-f1-slot'));assert.ok(!html.includes('Starting grid'));
 p.hideScores=true;assert.ok(!p._f1Dossier(f1Profile,{f1}).includes('Race winner'));
});
test('next weekend live and radar do not mount previous timing or Circle of Doom',()=>{
 const p=f1PanelFixture();p.view='live';p._radar=r=>`RADAR:${r?.event_name}`;
 const html=p._f1Dossier(f1Profile,{bridge:{available:true,cards_enabled:true,entities:{driver_positions:'sensor.old'}},f1:{focus:{name:'Next GP',sessions:[]},radar:{event_name:'Next GP'},live_available:false}});
 assert.ok(html.includes('Next GP'));assert.ok(html.includes('RADAR:Next GP'));assert.ok(html.includes(words.en.nextLivePending));assert.deepEqual(p._f1Specs,{});
});
test('a previous native starting grid cannot populate an unpublished next race',()=>{
 const resource={status:'ready',data:{status:'ready',context:{season:2026,round:21},payload:{attributes:{meeting_name:'Previous GP',grid:[{racing_number:'1',driver_name:'Old pole',grid_position:1}]}}}};
 assert.equal(f1WeekendModel(resource,{season:'2026',round:'22',meeting:'Next GP'},true).grid.length,0);
 assert.equal(f1WeekendModel(resource,{season:'2026',round:'21',meeting:'Previous GP'},true).grid.length,1);
});
test('archive responses stay with their requested year even when dropdowns change in flight',async()=>{
 const p=f1PanelFixture(),pending=[];p._hass.callWS=msg=>new Promise(resolve=>pending.push({msg,resolve}));
 const first=p._ensureF1Archive(f1Profile,{season:'2025',round:'1'});const second=p._ensureF1Archive(f1Profile,{season:'2024',round:'2'});
 pending[1].resolve({season:'2024',round:'2'});await second;pending[0].resolve({season:'2025',round:'1'});await first;
 assert.equal(p._f1Archives['league:racing:f1:2024:2'].data.season,'2024');assert.equal(pending[1].msg.round,2);
 const third=p._ensureF1Archive(f1Profile,{season:'2023',round:''});p._hass.user={id:'b'};pending[2].resolve({season:'2023'});await third;
 assert.equal(p._f1Archives['league:racing:f1:2023:last'].data,undefined);
});
test('changing archive year clears the previous round without changing live focus',()=>{
 const p=f1PanelFixture();p._dossierData=()=>({f1:{season:'2026'}});p._f1ArchiveSelection={season:'2025',round:'23'};
 p._changeF1Archive('f1-result-season','2024');assert.deepEqual(p._f1ArchiveSelection,{season:'2024',round:''});
 p._changeF1Archive('f1-result-race','5');assert.deepEqual(p._f1ArchiveSelection,{season:'2024',round:'5'});
});
