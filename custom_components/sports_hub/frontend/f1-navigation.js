import {escapeHtml} from './model.js';
import {words} from './i18n.js';
import {f1WeekendModel} from './f1-results-model.js';
import {radarUrl} from './radar.js';

const f1NavLabels={
 navSeason:['Season','Saison','Temporada','Saison','Stagione','Seizoen'],
 navStandings:['Championship standings','WM-Wertung','Clasificación del campeonato','Classement du championnat','Classifica mondiale','WK-stand'],
 navCalendar:['Race calendar','Rennkalender','Calendario de carreras','Calendrier des courses','Calendario gare','Racekalender'],
 navWeather:['Weather & radar','Wetter & Radar','Tiempo y radar','Météo et radar','Meteo e radar','Weer en radar'],
 navSections:['Sections','Bereiche','Secciones','Rubriques','Sezioni','Onderdelen'],
 gridUpdateHint:['Starting positions can still change due to penalties or pit-lane starts. Updates appear when published by the source.','Startplätze können sich durch Strafen oder Boxengassenstarts noch ändern. Änderungen erscheinen, sobald die Datenquelle sie veröffentlicht.','Las posiciones aún pueden cambiar por sanciones o salidas desde boxes. Se actualizan cuando la fuente publica los cambios.','Les positions peuvent encore changer après des pénalités ou des départs des stands. Les modifications apparaissent après publication par la source.','Le posizioni possono ancora cambiare per penalità o partenze dai box. Le modifiche appaiono quando vengono pubblicate dalla fonte.','Startposities kunnen nog veranderen door straffen of pitstraatstarts. Wijzigingen verschijnen zodra de bron ze publiceert.'],
};
for(const [key,values] of Object.entries(f1NavLabels))['en','de','es','fr','it','nl'].forEach((lang,i)=>{words[lang][key]=values[i];});

export function f1Availability(data,resource,now=Date.now()){
 const f1=data?.f1||{},focus=f1.focus,weekend=f1.weekend||{};
 const matches=focus&&String(focus.season||f1.season)===String(weekend.season)&&String(focus.round)===String(weekend.round);
 const native=Boolean(data?.bridge?.available&&data.bridge.cards_enabled);
 const model=matches?f1WeekendModel(resource,weekend,native,now):null;
 const readable=model&&!model.blocked&&!model.loading;
 return {qualifying:Boolean(readable&&model.qualifying?.length),grid:Boolean(readable&&(model.grid.length||model.pit.length||model.unassigned.length)),
   live:Boolean(focus&&native&&f1.live_available),weatherRadar:Boolean(focus&&(f1.forecast||radarUrl(f1.radar?.location)))};
}

export function f1NavigationGroups(available){
 return [{id:'home',label:'home',icon:'home',views:['home']},
  {id:'weekend',label:'weekend',icon:'practice',views:['practice',...(available.qualifying?['qualifying']:[]),...(available.grid?['grid']:[]),...(available.weatherRadar?['weatherRadar']:[])]},
  ...(available.live?[{id:'live',label:'live',icon:'live',views:['live','raceControl','strategy']}]:[]),
  {id:'season',label:'navSeason',icon:'championship',views:['championship','schedule']},
  {id:'results',label:'results',icon:'results',views:['results']},{id:'news',label:'news',icon:'news',views:['news']}];
}

export const f1NavigationMethods={
 async _f1GridWatcher(){return (await import('/local/f1-sensor-live-data-card/modular/connection.js')).watchCardData;},
 _stopF1Availability(){this._f1AvailabilityGeneration=(this._f1AvailabilityGeneration||0)+1;this._f1AvailabilityUnsubscribe?.();this._f1AvailabilityUnsubscribe=null;this._f1AvailabilityKey=null;this._f1AvailabilityResource=null;},
 async _watchF1Availability(profile,data){
  const bridge=data?.bridge,focus=data?.f1?.focus;
  if(!bridge?.available||!bridge.cards_enabled||!focus||!this._hass?.connection){if(this._f1AvailabilityKey)this._stopF1Availability();return;}
  const key=[this._hass.user?.id,profile.key,bridge.entry_id,focus.season,focus.round].join(':');
  if(key===this._f1AvailabilityKey&&this._f1AvailabilityConnection===this._hass.connection)return;
  this._stopF1Availability();this._f1AvailabilityKey=key;this._f1AvailabilityConnection=this._hass.connection;
  const generation=this._f1AvailabilityGeneration;
  try{
   // Keep discovery alive while an empty grid is hidden. The shared subscription
   // preserves F1 Sensor's spoiler protection, revision ordering and reconnects.
   const watchCardData=await this._f1GridWatcher();
   if(generation!==this._f1AvailabilityGeneration||!this.isConnected)return;
   this._f1AvailabilityUnsubscribe=watchCardData(this._hass,bridge.entry_id,'starting_grid',state=>{
    if(generation!==this._f1AvailabilityGeneration)return;
    const current=this._dossierData(profile),before=f1Availability(current,this._f1AvailabilityResource,this.now);
    this._f1AvailabilityResource=state;
    if(this.isConnected&&this.activeDashboard?.key===profile.key&&JSON.stringify(before)!==JSON.stringify(f1Availability(current,state,this.now)))this._render();
   });
  }catch{
   if(generation===this._f1AvailabilityGeneration){this._f1AvailabilityResource={status:'error'};if(this.isConnected&&this.activeDashboard?.key===profile.key)this._render();}
  }
 },
 _syncF1Navigation(profile,data){
  this._watchF1Availability(profile,data);
  const groups=f1NavigationGroups(f1Availability(data,this._f1AvailabilityResource,this.now));
  const allowed=groups.flatMap(g=>g.views);
  if(!allowed.includes(this.view))this.view=['grid','qualifying'].includes(this.view)?'practice':'home';
  const active=groups.find(g=>g.views.includes(this.view));
  this._f1NavMemory||={};this._f1NavMemory[profile.key+':'+active.id]=this.view;
  return {groups,active};
 },
 _selectF1Group(id){
  const profile=this.activeDashboard;if(profile?.target!=='racing:f1')return;
  const group=f1NavigationGroups(f1Availability(this._dossierData(profile),this._f1AvailabilityResource,this.now)).find(g=>g.id===id);
  if(!group)return;
  const previous=this._f1NavMemory?.[profile.key+':'+id];this.view=group.views.includes(previous)?previous:group.views[0];
  this._detail=null;this._render();this.shadowRoot.querySelector('.shell').scrollTop=0;
 },
 _f1Navigation(profile,data,icon){
  const groups=f1NavigationGroups(f1Availability(data,this._f1AvailabilityResource,this.now));
  const active=groups.find(g=>g.views.includes(this.view))||groups[0];
  const labels={championship:'navStandings',schedule:'navCalendar',weatherRadar:'navWeather',live:'timing'};
  return `<div class="f1-navigation"><nav class="nav f1-primary-nav" aria-label="Formula 1">${groups.map(g=>`<button data-action="f1-group" data-value="${g.id}" class="${g.id===active.id?'active':''}" ${g.id===active.id?'aria-current="true"':''}>${icon(g.icon)}${escapeHtml(this.t[g.label])}</button>`).join('')}</nav>${active.views.length>1?`<nav class="f1-subnav" aria-label="${escapeHtml(this.t[active.label]+' · '+this.t.navSections)}">${active.views.map(view=>`<button data-action="view" data-value="${view}" class="${view===this.view?'active':''}" ${view===this.view?'aria-current="page"':''}>${icon(view)}${escapeHtml(this.t[labels[view]||view])}</button>`).join('')}</nav>`:''}</div>`;
 },
};

export const f1NavigationStyles=`
.f1-navigation{margin-bottom:28px}.nav.f1-primary-nav{display:flex;flex-wrap:wrap;overflow:visible;gap:6px;margin-bottom:0;padding:0 0 10px;border-bottom:1px solid var(--line)}.nav.f1-primary-nav button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:10px 15px;white-space:normal;line-height:1.35;border:1px solid transparent;border-radius:11px;font-size:14px}.nav.f1-primary-nav button.active{background:color-mix(in srgb,var(--club) 12%,#131b25);border-color:color-mix(in srgb,var(--club) 55%,transparent)}.f1-subnav{display:flex;flex-wrap:wrap;gap:7px;padding-top:13px}.f1-subnav button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:9px 13px;background:#ffffff03;color:var(--muted);border:1px solid var(--line);border-radius:10px;font-size:13px;line-height:1.35;white-space:normal}.f1-subnav button.active{color:var(--ink);background:#ffffff0c;border-color:#ffffff45}.f1-subnav svg{height:17px;width:17px;flex-shrink:0}.f1-navigation button:focus-visible{outline:2px solid var(--aqua);outline-offset:3px}@media(max-width:700px){.nav.f1-primary-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;overflow:visible}.nav.f1-primary-nav button{justify-content:flex-start;font-size:12px;padding:10px}.f1-subnav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.f1-subnav button{font-size:12px;text-align:left;justify-content:flex-start;padding:10px}.f1-navigation{margin-bottom:20px}}
`;
