import {escapeHtml, safeUrl} from './model.js';

// Same modular F1 Sensor card contract used by the reference Formula 1 dashboard.
export function f1CardConfig(title,modules,entryId,live=false){
  return {type:'custom:f1-sensor-card',version:3,f1_entry_id:entryId,title,layout:'stack',appearance:{style:'ha',mode:'dark',font:'system',density:'compact',surface:'soft',accent_mode:'custom',accent:'#ff453a',show_header:true,full_names:true,logo_style:'color',tyre_style:'ring'},context:{show_focus_control:live,show_freeze_control:live,...(live?{selection:{mode:'follow',source:'live'}}:{})},styles:'ha-card { --f1-card-radius: 20px; --f1-card-padding: 22px; --f1-surface: #111722; --f1-panel: #192231; --f1-text: #edf2fa; --f1-muted: #a6b3c6; --f1-border: #2b3748; --f1-accent: #ff453a; border: 1px solid #2b3748; border-top: 3px solid #ff453a; }',modules};
}
export const f1DossierMethods={
  _f1Slot(id,title,modules,wide=false,live=false){
    this._f1Specs[id]={title,modules,live};
    return `<section class="f1-slot ${wide?'f1-wide':''}" data-f1-slot="${escapeHtml(id)}" aria-label="${escapeHtml(title)}"><p class="meta">${escapeHtml(title)} · ${escapeHtml(this.t.loading)}</p></section>`;
  },
  _f1Dossier(profile,data){
    this._f1Specs={};const f1=data?.f1||{},native=data?.bridge?.available&&data?.bridge?.cards_enabled;
    const module=(type,title,options={},fields)=>({type,title,options,...(fields?{fields}:{})});
    const slot=(id,title,modules,wide=false,live=false)=>this._f1Slot(id,title,modules,wide,live);
    const standings=(teams=false,rows=teams?11:22)=>module('standings',teams?this.t.constructors:this.t.drivers,{competitors:teams?'teams':'drivers',rows,show_availability_notice:false},['result_position',teams?'team':'driver','points','wins']);
    const control=limit=>module('race_control',this.t.raceControl,{limit,order:'newest',list_max_height:600,show_clear_button:false});
    let content='';
    const header=`<div class="dossier-heading f1-heading"><div><div class="eyebrow">FORMULA 1 · ${escapeHtml(f1.season||'')}</div><h1>${escapeHtml(profile.name)}</h1></div>${this._hass?.panels?.['dashboard-f1']?`<a class="cta" href="/dashboard-f1">${escapeHtml(this.t.nativeF1)} ↗</a>`:''}</div><div class="dossier-controls"><span class="meta">${escapeHtml(this.t.f1Access)}</span><button class="spoiler" data-action="spoiler" aria-pressed="${this.hideScores}">${escapeHtml(this.hideScores?this.t.show:this.t.hide)}</button></div>`;
    if(this.view==='news')return header+this._dossierSection(this.t.news,this._news(data));
    if(this.hideScores&&!['home','schedule'].includes(this.view))return header+this._spoilerNotice();
    if(native){
      if(this.view==='home'){
        content+=slot('overview',this.t.nextUp,[module('overview','',{layout_mode:'full'},['meeting','circuit','countdown','circuit_map'])],true);
        if(!this.hideScores)content+=slot('starting-grid',this.t.grid,[],true);
        content+=slot('forecast',this.t.forecast,[module('weather','',{content:'race_forecast',presentation:'metrics',show_explanation:false},['weather_condition','temperature','rain_probability','wind'])]);
        content+=slot('weekend',this.t.weekend,[module('calendar','',{range:'weekend',timezone:'home',past:'dim',next:'label'})]);
        if(!this.hideScores){content+=slot('compact-wm',this.t.championship,[standings(false,5),standings(true,5)]);content+=slot('last-control',this.t.raceControl,[module('race_control','',{presentation:'latest_message',limit:1,show_clear_button:false})],false,true);}
      }else if(this.view==='live'){
        content+=slot('race-status',this.t.live,[module('overview','',{},['meeting','session','session_status','lap_progress','track_status'])],true,true);
        if(data.bridge.entities?.driver_positions)content+=slot('circle','Circle of Doom',[],true,true);
        content+=slot('timing',this.t.timing,[module('timing','',{profile:'auto',rows:22,detail_laps:3})],true,true);
        content+=slot('live-control',this.t.raceControl,[control(60)],false,true);
        content+=slot('weather',this.t.trackWeather,[module('weather','',{content:'track_conditions',presentation:'metrics'})],false,true);
        content+=slot('live-tyres',this.t.tyres,[module('tyres','',{content:'current',rows:22})],false,true);
      }else if(this.view==='qualifying')content+=slot('qualifying',this.t.qualifying,[],true);
      else if(this.view==='grid')content+=slot('starting-grid',this.t.grid,[],true);
      else if(this.view==='championship'){
        content+=slot('drivers',this.t.drivers,[standings()]);content+=slot('constructors',this.t.constructors,[standings(true)]);
        content+=slot('progression',this.t.progression,[module('progression','',{series_limit:5,show_future_rounds:false,chart_height:320})],true);
      }else if(this.view==='schedule')content+=slot('season',this.t.seasonSchedule,[module('calendar','',{range:'season',sessions:['race'],past:'dim',next:'label',details:['round','circuit'],timezone:'home'})],true);
      else if(this.view==='results'){
        content+=slot('qualifying',this.t.qualifying,[],true);
        content+=slot('results',this.t.results,[module('results',this.t.recentMatches,{content:'latest_race',rows:22},['result_position','driver','result_time','points'])]);
        content+=slot('starting-grid',this.t.grid,[],true);
        content+=slot('replay',this.t.replay,[module('replay','',{display:'compact'})],true);
      }else if(this.view==='raceControl'){
        content+=slot('control',this.t.raceControl,[control(100)],true,true);
        content+=slot('documents',this.t.documents,[module('documents','',{limit:20,list_max_height:600})]);
        content+=slot('investigations',this.t.investigations,[module('incidents','',{content:'investigations',rows:30})],false,true);
        content+=slot('limits','Track limits',[module('incidents','',{content:'track_limits_summary',rows:22})],true,true);
      }else if(this.view==='strategy'){
        if(data.bridge.entities?.driver_positions)content+=slot('circle','Circle of Doom',[],true,true);
        content+=slot('tyres',this.t.tyres,[module('tyres','',{content:'current',rows:22})],false,true);
        content+=slot('pits',this.t.pitStops,[module('pit_stops','',{rows:22})],false,true);
      }
      content=`<div class="f1-grid">${content}</div>`;
      if(this.view==='home')content+=this._dossierSection(this.t.news,this._news(data,4),'view','news');
      // Independent season data remains usable if F1 Sensor's cards cannot load.
      if(['home','championship','schedule','results'].includes(this.view))content+=`<details class="source-details f1-independent"><summary>Jolpica · ${escapeHtml(this.t.seasonOverview)}</summary>${this._f1Fallback(f1)}</details>`;
    }else content=`${data?`<p class="notice">${escapeHtml(this.t.f1Setup)} <a href="https://nicxe.github.io/f1_sensor/" target="_blank" rel="noopener noreferrer">F1 Sensor ↗</a></p>`:''}${this._f1Fallback(f1)}${this.view==='home'?this._dossierSection(this.t.news,this._news(data,4),'view','news'):''}`;
    if(!native&&!this.hideScores){
      const resultSlots=['qualifying','results'].includes(this.view)?slot('qualifying',this.t.qualifying,[],true):'';
      const gridSlot=['home','grid','results'].includes(this.view)?slot('starting-grid',this.t.grid,[],true):'';
      content=`<div class="f1-grid">${resultSlots}${gridSlot}</div>`+content;
    }
    return header+content;
  },
  _f1Fallback(f1){
    const races=f1.calendar||[],next=races.find(r=>Date.parse(r.date)+4*3600000>=this.now);
    const table=(rows,columns)=>rows?.length?`<div class="table-scroll"><table class="standings-table"><thead><tr>${columns.map(([,label])=>`<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key])=>`<td>${escapeHtml(row[key]??'–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:this._dossierEmpty();
    let html='';
    if(this.view==='home'){
      html=next?`<div class="dossier-hero f1-hero"><div class="eyebrow">${escapeHtml(this.t.nextUp)} · ${escapeHtml(this.t.round)} ${escapeHtml(next.round)}</div><h1>${escapeHtml(next.name)}</h1><p>${escapeHtml(next.circuit)} · ${escapeHtml(next.locality)}, ${escapeHtml(next.country)}</p><div class="session-grid">${next.sessions.map(s=>`<div><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(this._format(s.date,{weekday:'short',day:'numeric',month:'short'}))}</span><b>${escapeHtml(s.time_confirmed?this._format(s.date,{hour:'2-digit',minute:'2-digit'}):this.t.timeTbd)}</b></div>`).join('')}</div></div>`:this._dossierEmpty();
    }
    if(['home','championship'].includes(this.view))html+=this.hideScores?this._spoilerNotice():`<div class="f1-grid">${this._dossierSection(this.t.drivers,table(this.view==='home'?f1.drivers?.slice(0,5):f1.drivers,[['rank','#'],['name',this.t.drivers],['team',this.t.team],['points',this.t.points],['wins',this.t.wins]]))}${this._dossierSection(this.t.constructors,table(this.view==='home'?f1.constructors?.slice(0,5):f1.constructors,[['rank','#'],['name',this.t.team],['points',this.t.points],['wins',this.t.wins]]))}</div>`;
    if(this.view==='schedule')html+=this._dossierSection(this.t.seasonSchedule,`<div class="race-calendar">${races.map(r=>`<details class="race-round ${Date.parse(r.date)<this.now?'past':''}"><summary><span class="round-number">${escapeHtml(r.round)}</span><div><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.circuit)}</small></div><time>${escapeHtml(this._format(r.date,{day:'numeric',month:'short'}))}</time></summary><div class="session-grid">${r.sessions.map(s=>`<div><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.time_confirmed?this._format(s.date,{weekday:'short',hour:'2-digit',minute:'2-digit'}):this.t.timeTbd)}</span></div>`).join('')}</div></details>`).join('')}</div>`);
    if(this.view==='results')html+=this.hideScores?this._spoilerNotice():this._dossierSection(f1.result_name||this.t.results,table(f1.results,[['rank','#'],['name',this.t.drivers],['team',this.t.team],['laps',this.t.laps],['time',this.t.time],['points',this.t.points]]));
    return html;
  },
  async _mountF1(){
    const specs=this._f1Specs,profile=this.activeDashboard,data=profile&&this._dossierData(profile),bridge=data?.bridge;
    if(!specs||!this.shadowRoot.querySelector('[data-f1-slot]')){this._nativeCards=new Map();return;}
    const generation=this._f1Generation=(this._f1Generation||0)+1;
    this._nativeCards||=new Map();
    const current=new Map();
    try{
      if(bridge?.available&&Object.keys(specs).some(id=>!['starting-grid','qualifying'].includes(id))&&!customElements.get('f1-sensor-card')){try{await import('/local/f1-sensor-live-data-card/register.js?legacy=0');}catch{/* Public results remain usable if optional native modules fail to load. */}}
      if(specs.circle&&!customElements.get('f1-circle-of-doom-card'))await import(new URL('./vendor/f1-circle-of-doom-card.js',import.meta.url));
      if(generation!==this._f1Generation||!this.isConnected)return;
      for(const [id,spec] of Object.entries(specs)){
        const slot=this.shadowRoot.querySelector(`[data-f1-slot="${id}"]`);if(!slot)continue;
        try{
          const circle=id==='circle',startingGrid=['starting-grid','qualifying'].includes(id),entities=bridge?.entities||{};
          const config=startingGrid?{entry_id:bridge?.cards_enabled?bridge.entry_id:null,compact:this.view==='home',driver_list_entity:entities.driver_list,mode:id==='qualifying'?'qualifying':'grid',weekend:data?.f1?.weekend}:circle?{type:'custom:f1-circle-of-doom-card',title:'Circle of Doom',entity:entities.driver_positions,session_entity:entities.current_session,session_status_entity:entities.session_status,track_status_entity:entities.track_status,uncertainty:2,stale_after:90}:f1CardConfig(spec.title,spec.modules,bridge.entry_id,spec.live);
          const signature=JSON.stringify(config),old=this._nativeCards.get(id);
          const card=old?.signature===signature?old.card:document.createElement(startingGrid?'sports-hub-starting-grid':circle?'f1-circle-of-doom-card':'f1-sensor-card');
          if(card!==old?.card)card.setConfig(config);
          card.hass=this._hass;slot.replaceChildren(card);current.set(id,{card,signature});
        }catch{slot.innerHTML=`<p class="notice">${escapeHtml(this.t.f1CardError)}</p>`;}
      }
      this._nativeCards=current;
    }catch{if(generation===this._f1Generation)for(const slot of this.shadowRoot.querySelectorAll('[data-f1-slot]'))slot.innerHTML=`<p class="notice">${escapeHtml(this.t.f1CardError)}</p>`;}
  },
};
