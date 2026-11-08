import {safeUrl, searchMatches} from './model.js';

export const colorValue=(value,fallback='#315bd6')=>/^#?[0-9a-f]{6}$/i.test(String(value||''))?'#'+String(value).replace('#','').toLowerCase():fallback;
export function contrastColor(color) {
  const rgb=colorValue(color).slice(1).match(/../g).map(v=>{const x=parseInt(v,16)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
  const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#08101b' : '#ffffff';
}
const leagueColors={
  'soccer:ger.1':'#d20515','soccer:ger.2':'#d20515','soccer:ger.dfb_pokal':'#008347',
  'soccer:eng.1':'#37003c','soccer:eng.2':'#103a72','soccer:eng.fa':'#d71920','soccer:eng.league_cup':'#008542',
  'soccer:esp.1':'#ff4b44','soccer:esp.copa_del_rey':'#c8102e','soccer:ita.1':'#005aff','soccer:ita.coppa_italia':'#007c46',
  'soccer:fra.1':'#cdfb0a','soccer:fra.coupe_de_france':'#003c71','soccer:ned.1':'#e30613','soccer:por.1':'#007d44',
  'soccer:uefa.champions':'#0e1e5b','soccer:uefa.europa':'#ff6900','soccer:uefa.europa.conf':'#00be14',
  'soccer:usa.1':'#00529b','soccer:usa.nwsl':'#c72c41','basketball:nba':'#17408b','basketball:wnba':'#f15a24',
  'football:nfl':'#013369','hockey:nhl':'#a2aaad','baseball:mlb':'#002d72',
  'tennis:atp':'#003a70','tennis:wta':'#6b278d','racing:f1':'#e10600','racing:irl':'#da291c',
  'racing:nascar-premier':'#ffcc00','racing:nascar-secondary':'#007934','racing:nascar-truck':'#e31837',
  'golf:pga':'#003d79','golf:lpga':'#e31837','golf:eur':'#002d72','golf:liv':'#c4d600','mma:ufc':'#d20a0a',
};
export function profileFromParticipant(participant,event) {
  return {key:`team:${participant.key}`,kind:'team',target:participant.key,name:participant.name,
    context:event.league,league_id:event.league_id,sport:event.sport,logo:safeUrl(participant.logo),color:colorValue(participant.color),
    alternate_color:colorValue(participant.alternate_color,'#ffffff'),abbreviation:participant.abbreviation||'',short_name:participant.short_name||''};
}
export function profileFromLeague(league) {
  return {key:`league:${league.id}`,kind:'league',target:league.id,league_id:league.id,name:league.name,sport:league.sport,
    logo:safeUrl(league.logo),color:colorValue(league.color,leagueColors[league.id]||'#315bd6'),
    alternate_color:colorValue(league.alternate_color,'#ffffff')};
}
export function dashboardEvents(events,profile) {
  if(!profile)return events;
  return events.filter(event=>profile.kind==='league'?event.league_id===profile.target:event.participants.some(p=>p.key===profile.target));
}
export function discoverProfiles(data,query='') {
  const profiles=new Map();
  for(const league of data?.leagues||[]){const p=profileFromLeague(league);profiles.set(p.key,p);}
  for(const event of data?.events||[])for(const participant of event.participants||[]){
    if(!participant.key)continue;
    const p=profileFromParticipant(participant,event),old=profiles.get(p.key);
    // Prefer an entry with actual branding when tournaments omit team metadata.
    if(!old||participant.color)profiles.set(p.key,{...old,...p,logo:p.logo||old?.logo||''});
  }
  return [...profiles.values()].filter(p=>searchMatches([p.name,p.short_name,p.abbreviation],query));
}
export function approvedProfile(profiles,key){return (profiles||[]).find(p=>p.key===key)||null;}
