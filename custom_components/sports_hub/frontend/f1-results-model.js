import {startingGridModel} from './lineup-layout.js';

// Verified on formula1.com/en/teams, 2026-11-08. Never reuse a livery for another season.
const f1Cars2026={
 mercedes:['mercedes','27f4d2'],ferrari:['ferrari','e8002d'],redbull:['redbullracing','3671c6'],mclaren:['mclaren','ff8000'],
 racingbulls:['racingbulls','6692ff'],alpine:['alpine','ff87bc'],haas:['haasf1team','b6babd'],audi:['audi','ff2d00'],
 williams:['williams','64c4ff'],astonmartin:['astonmartin','229971'],cadillac:['cadillac','b3b5b8'],
};
const f1TeamAliases={redbullracing:'redbull',oracleredbullracing:'redbull',rbf1team:'racingbulls',rb:'racingbulls',visacashappracingbulls:'racingbulls',haasf1team:'haas',tgrhaasf1team:'haas',mercedesamgpetronasf1team:'mercedes',scuderiaferrari:'ferrari',scuderiaferrarihp:'ferrari',bwtalpinef1team:'alpine',astonmartinaramcof1team:'astonmartin',williamsracing:'williams',mclarenf1team:'mclaren',audirevolutf1team:'audi',cadillacf1team:'cadillac'};
function f1TeamKey(team){const value=String(team||'').toLowerCase().replace(/[^a-z0-9]/g,'');return f1TeamAliases[value]||value;}
export function f1CarAsset(team,season){
 const item=String(season)==='2026'?f1Cars2026[f1TeamKey(team)]:null;
 return item?{url:`https://media.formula1.com/image/upload/c_lfill,h_224/q_auto/d_common:f1:2026:fallback:car:2026fallbackcarright.webp/v1740000001/common/f1/2026/${item[0]}/2026${item[0]}carright.webp`,color:'#'+item[1]}:null;
}
// Public 2026 portrait paths verified on formula1.com/en/drivers, 2026-11-08.
// Match the person's name and season, never just a racing number.
const f1Portraits2026={
 georgerussell:['mercedes','georus01'],kimiantonelli:['mercedes','andant01'],charlesleclerc:['ferrari','chalec01'],lewishamilton:['ferrari','lewham01'],
 maxverstappen:['redbullracing','maxver01'],isackhadjar:['redbullracing','isahad01'],landonorris:['mclaren','lannor01'],oscarpiastri:['mclaren','oscpia01'],
 liamlawson:['racingbulls','lialaw01'],arvidlindblad:['racingbulls','arvlin01'],pierregasly:['alpine','piegas01'],francocolapinto:['alpine','fracol01'],
 oliverbearman:['haasf1team','olibea01'],rafaelcamara:['haasf1team','rafcam01'],nicohulkenberg:['audi','nichul01'],gabrielbortoleto:['audi','gabbor01'],
 carlossainz:['williams','carsai01'],alexanderalbon:['williams','alealb01'],fernandoalonso:['astonmartin','feralo01'],lancestroll:['astonmartin','lanstr01'],
 sergioperez:['cadillac','serper01'],valtteribottas:['cadillac','valbot01'],
};
export function f1DriverAsset(name,season){
 let key=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
 key=({andreakimiantonelli:'kimiantonelli',alexalbon:'alexanderalbon',nicohuelkenberg:'nicohulkenberg'})[key]||key;
 const item=String(season)==='2026'?f1Portraits2026[key]:null;
 return item?{url:`https://media.formula1.com/image/upload/c_lfill,w_440/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000001/common/f1/2026/${item[0]}/${item[1]}/2026${item[0]}${item[1]}right.webp`}:null;
}
export function f1WeekendModel(resource,weekend={},native=false,now=Date.now()){
 const model=startingGridModel(resource),packet=resource?.data;
 // Do not briefly reveal public results while the protected channel checks spoiler state.
 if(model.blocked||(native&&!resource)||native&&model.loading)return {...model,qualifying:[],notes:[]};
 const q=weekend.qualifying||{},g=weekend.grid||{},qrows=(q.rows||[]).slice(0,40),grows=(g.rows||[]).slice(0,40);
 const byNumber=new Map(qrows.map(r=>[r.number,r]));
 const normalize=r=>({id:r.number,position:r.position,name:r.name,code:r.code||'',number:r.number,team:r.team,
   color:f1CarAsset(r.team,weekend.season)?.color,time:r.time||r.q3||r.q2||r.q1||'',
   qualifyingPosition:byNumber.get(r.number)?.position,delta:Number.isInteger(r.position)&&r.position>0&&byNumber.get(r.number)?.position>0?r.position-byNumber.get(r.number).position:null});
 const fromQ=!grows.length&&qrows.length&&now<=Date.parse(weekend.race_date)+10*3600000;
 const rows=(grows.length?grows:fromQ?qrows:[]).map(normalize);
 const source=grows.length?g:q;
 const publicGrid=rows.length?{grid:rows.filter(r=>r.position>0).sort((a,b)=>a.position-b.position),pit:rows.filter(r=>r.position===0),unassigned:rows.filter(r=>r.position==null),
   status:grows.length?'published':'provisional',source:source.source,sourceUrl:source.url,updated:source.updated_at,stale:source.stale,meeting:weekend.meeting,session:'Race',season:weekend.season,date:weekend.race_date,notes:source.notes||[]}:{};
 const season=packet?.context?.season;
 return {...model,loading:native&&model.loading,season,notes:[],...publicGrid,qualifying:qrows,qualifyingSource:q.source,qualifyingUrl:q.url,qualifyingUpdated:q.updated_at,qualifyingStale:q.stale,
   qualifyingMeeting:weekend.meeting,qualifyingDate:weekend.qualifying_date,qualifyingNotes:q.notes||[],qualifyingSeason:weekend.season,gridByNumber:new Map(grows.map(r=>[r.number,r.position]))};
}
