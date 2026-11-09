import {escapeHtml,safeUrl,dateKey} from './model.js';
import {personalSections,monthDays,moveMonth} from './personal-model.js';

export const personalMethods={
 _loadPreferences(){
  if(!this._hass?.user?.id||!this._panel?.config?.entry_id)return;
  const key=`sports-hub:${this._panel.config.entry_id}:${this._hass.user.id}`;
  if(key===this._storageKey)return;
  this._storageKey=key;this.favorites=[];this.favoriteNames={};this.hideScores=false;this._preferenceQueue=[];this._preferences=null;this._personalData=null;this._settingsDraft=null;this._personalFetched=0;this._settingsSaved=false;this._settingsSaving=false;this._personalBusy=false;this._preferenceBusy=false;this._preferenceError=false;
  try{const saved=JSON.parse(localStorage.getItem(key)||'{}');this._legacyPreferences=saved;this.favorites=Array.isArray(saved.favorites)?saved.favorites:[];this.favoriteNames=saved.names||{};this.hideScores=saved.hideScores===true;}catch{this._legacyPreferences={};}
 },
 _cachePreferences(){try{if(this._storageKey)localStorage.setItem(this._storageKey,JSON.stringify({favorites:this.favorites,names:this.favoriteNames,hideScores:this.hideScores}));}catch{}},
 _applyPreferences(prefs){
  if(!prefs)return;
  const first=!this._preferences;const previous=JSON.stringify(this.favorites);
  this._preferences=prefs;this.favorites=Object.keys(prefs.favorites||{});this.favoriteNames=Object.fromEntries(Object.entries(prefs.favorites||{}).map(([key,value])=>[key,value.name]));this.hideScores=prefs.settings.hide_scores;
  if(previous!==JSON.stringify(this.favorites))this._personalFetched=0;
  if(first&&!this.activeDashboard&&['home','myday'].includes(this.view))this.view=prefs.settings.start_view;
  this._cachePreferences();
  for(const {card} of this._nativeCards?.values()||[])if(card.tagName==='SPORTS-HUB-STARTING-GRID')card.visualPreference=prefs.settings.grid_visual;
 },
 async _syncPreferences(){
  const userId=this._hass.user?.id;
  if(this._preferenceQueue?.length){await this._flushPreferences();return;}
  try{
   let prefs=await this._hass.callWS({type:'sports_hub/personal'});
   if(!prefs.initialized)prefs=await this._hass.callWS({type:'sports_hub/personal',action:'initialize',legacy:this._legacyPreferences||{}});
   if(this._hass.user?.id!==userId)return;
   if(!this._preferenceQueue?.length)this._applyPreferences(prefs);
   this._preferenceError=false;
   if(prefs.settings.language!==this.lang)this._queuePreference({action:'settings',settings:{language:this.lang||'en'}});
  }catch{if(this._hass.user?.id===userId)this._preferenceError=true;}
 },
 _queuePreference(payload){
  this._preferenceQueue||=[];this._preferenceQueue.push(payload);this._flushPreferences();
 },
 async _flushPreferences(){
  if(this._preferenceBusy||!this._hass)return;
  const userId=this._hass.user?.id,queue=this._preferenceQueue;this._preferenceBusy=true;
  try{
   while(queue.length){
    const result=await this._hass.callWS({type:'sports_hub/personal',...queue[0]});
    if(this._hass.user?.id!==userId)return;
    queue.shift();if(!queue.length)this._applyPreferences(result);
   }
   this._preferenceError=false;this._personalFetched=0;
  }catch{if(this._hass.user?.id===userId)this._preferenceError=true;}
  finally{if(this._hass.user?.id===userId){this._preferenceBusy=false;this._render();}}
 },
 _savePreferences(){this._cachePreferences();this._queuePreference({action:'settings',settings:{hide_scores:this.hideScores}});},
 _saveFavorite(key,enabled,profile){
  this._cachePreferences();this._personalData=null;this._personalFetched=0;
  this._queuePreference({action:'favorite',key,enabled,...(profile?{profile}:{}),name:this.favoriteNames[key]||key});
 },
 async _ensurePersonal(force=false){
  if(this._personalBusy||!this._hass||(!force&&this._personalFetched&&Date.now()-this._personalFetched<60000))return;
  if(!this._preferences&&!this._panel?.config?.preview)return;
  const userId=this._hass.user?.id,revision=this._preferences?.revision;this._personalBusy=true;
  try{
   const data=await this._hass.callWS({type:'sports_hub/personal',action:'feed'});
   if(this._hass.user?.id!==userId)return;
   if(this._preferences?.revision!==revision)return;
   this._personalData=data;this._personalFetched=Date.now();this._personalError=false;
  }catch{if(this._hass.user?.id===userId){this._personalError=true;this._personalFetched=Date.now();}}
  finally{if(this._hass.user?.id===userId){this._personalBusy=false;if(this.isConnected)this._render();}}
 },
 _personalProfiles(){return this._personalData?.profiles||Object.values(this._preferences?.favorites||{}).map(v=>v.profile).filter(Boolean);},
 _personalEvents(){
  const base=this._data?.events||[],extra=this._personalData?.events||[];
  return [...new Map([...extra,...base].filter(e=>this.favorites.includes('league:'+e.league_id)||e.participants.some(p=>this.favorites.includes(p.key))).map(e=>[e.id,e])).values()];
 },
 _personalStatus(){return `${this._preferenceError?`<p class="alert" role="status">${escapeHtml(this.t.syncError)} <button class="cta" data-action="personal-retry">${escapeHtml(this.t.retry)}</button></p>`:''}${this._personalError?`<p class="alert">${escapeHtml(this.t.richError)} <button class="cta" data-action="personal-retry">${escapeHtml(this.t.retry)}</button></p>`:''}${this._personalBusy&&!this._personalData?`<p class="meta" role="status">${escapeHtml(this.t.loading)}</p>`:''}${this._personalData?.limited?`<p class="notice">${escapeHtml(this.t.agendaLimit)}</p>`:''}${this._personalData?.sources?.some(s=>s.stale)?`<p class="alert">${escapeHtml(this.t.stale)}</p>`:''}`;},
 _myDay(){
  this._ensurePersonal();const sections=personalSections(this._personalEvents(),this.now,this.zone),focus=sections.live[0]||sections.upcoming[0],profiles=this._personalProfiles();
  const block=(title,events)=>events.length?`<section class="personal-section"><div class="section-head"><h2>${escapeHtml(title)}</h2><span class="count">${events.length}</span></div><div class="games">${events.slice(0,6).map(e=>this._game(e)).join('')}</div></section>`:'';
  return this._personalStatus()+`<div class="personal-hero"><section><div class="eyebrow">${escapeHtml(this._format(new Date(this.now).toISOString(),{weekday:'long',day:'numeric',month:'long'}))}</div><h1>${escapeHtml(this.t.myday)}</h1><p>${escapeHtml(this.t.mydayIntro)}</p><div class="personal-actions"><button class="cta primary" data-action="view" data-value="calendar">${escapeHtml(this.t.calendar)} →</button><button class="cta" data-action="view" data-value="personalSettings">${escapeHtml(this.t.personalSettings)}</button><button class="spoiler" data-action="spoiler" aria-pressed="${this.hideScores}">${escapeHtml(this.hideScores?this.t.show:this.t.hide)}</button></div><div class="metrics"><div class="metric"><strong>${sections.today.length}</strong><small>${escapeHtml(this.t.eventsToday)}</small></div><div class="metric"><strong>${sections.live.length}</strong><small>${escapeHtml(this.t.liveNow)}</small></div><div class="metric"><strong>${this.favorites.length}</strong><small>${escapeHtml(this.t.favoriteList)}</small></div></div></section><section class="personal-next"><span class="eyebrow">${escapeHtml(sections.live.length?this.t.spotlight:this.t.nextUp)}</span>${focus?this._game(focus):`<h2>${escapeHtml(this.t.noUpcoming)}</h2><p>${escapeHtml(this.favorites.length?this.t.agendaCoverage:this.t.followToStart)}</p>`}</section></div>${!this.favorites.length?`<div class="empty"><h2>${escapeHtml(this.t.followToStart)}</h2><p>${escapeHtml(this.t.mydayEmpty)}</p><button class="cta primary" data-action="view" data-value="home">${escapeHtml(this.t.discoverSports)} →</button></div>`:''}<div class="followed-strip">${profiles.map(p=>`<button class="followed-card" data-action="${this.dashboards.some(d=>d.key===p.key)?'dashboard-open':'dashboard-preview'}" data-value="${escapeHtml(p.key)}">${this._profileLogo(p)}<span>${escapeHtml(p.name)}</span></button>`).join('')}</div>${block(this.t.liveNow,sections.live)}${block(this.t.nextUp,sections.upcoming)}${block(this.t.results,sections.results)}${this.hideScores?`<p class="notice">${escapeHtml(this.t.newsSpoilers)}</p>`:this._personalData?.news?.length?`<section class="personal-section"><h2>${escapeHtml(this.t.news)}</h2><div class="news-grid">${this._personalData.news.map(a=>`<a class="news-card" href="${escapeHtml(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer"><div class="news-meta"><span>${escapeHtml(a.followed_name)}</span><span>${escapeHtml(a.source)}</span></div><h3>${escapeHtml(a.title)}</h3><small>${escapeHtml(this._format(a.published,{dateStyle:'medium'}))}</small></a>`).join('')}</div></section>`:''}<p class="meta">${escapeHtml(this.t.agendaCoverage)}</p>`;
 },
 _calendarFormat(value,options){return new Intl.DateTimeFormat(this.lang,{timeZone:'UTC',...options}).format(new Date(value+'T12:00:00Z'));},
 _calendarView(){
  this._ensurePersonal();this._calendarMonth||=dateKey(this.now,this.zone).slice(0,7);this._calendarDay||=dateKey(this.now,this.zone);
  const events=this._personalEvents(),days=monthDays(this._calendarMonth),grouped=new Map();for(const e of events){const key=dateKey(e.date,this.zone);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(e);}
  const dayEvents=grouped.get(this._calendarDay)||[];
  const week=days.slice(0,7).map(d=>this._calendarFormat(d,{weekday:'short'}));
  return this._personalStatus()+`<div class="section-head"><div><h1>${escapeHtml(this.t.calendar)}</h1><p>${escapeHtml(this.t.calendarIntro)}</p></div><button class="cta" data-action="view" data-value="personalSettings">${escapeHtml(this.t.personalSettings)}</button></div><div class="calendar-layout"><section class="calendar-month"><div class="calendar-controls"><button class="cta" data-action="calendar-shift" data-value="-1" aria-label="${escapeHtml(this.t.previousMonth)}">←</button><h2>${escapeHtml(this._calendarFormat(this._calendarMonth+'-15',{month:'long',year:'numeric'}))}</h2><button class="cta" data-action="calendar-shift" data-value="1" aria-label="${escapeHtml(this.t.nextMonth)}">→</button><button class="cta" data-action="calendar-today">${escapeHtml(this.t.today)}</button></div><div class="calendar-grid">${week.map(d=>`<span class="calendar-weekday">${escapeHtml(d)}</span>`).join('')}${days.map(day=>{const list=grouped.get(day)||[];return `<button class="calendar-day ${day.slice(0,7)!==this._calendarMonth?'outside':''} ${day===this._calendarDay?'selected':''} ${day===dateKey(this.now,this.zone)?'today':''}" data-action="calendar-day" data-value="${day}" aria-pressed="${day===this._calendarDay}" aria-label="${escapeHtml(day+' · '+list.length+' '+this.t.events)}"><b>${Number(day.slice(-2))}</b>${list.length?`<span class="day-count">${list.length}</span><small>${escapeHtml(list[0].name)}</small>`:''}</button>`;}).join('')}</div></section><section class="calendar-agenda"><h2>${escapeHtml(this._calendarFormat(this._calendarDay,{weekday:'long',day:'numeric',month:'long'}))}</h2><div class="calendar-events">${dayEvents.map(e=>this._game(e)).join('')||`<p class="meta">${escapeHtml(this.t.noEvents)}</p>`}</div></section></div><p class="meta">${escapeHtml(this.t.agendaCoverage)} ${this._personalData?escapeHtml(this._format(this._personalData.window_start,{dateStyle:'medium'})+' – '+this._format(this._personalData.window_end,{dateStyle:'medium'})):''}</p><p class="meta">${escapeHtml(this.t.calendarTiming)}</p>`;
 },
 _settingsView(){
  const s=this._preferences?{...this._preferences.settings,...this._settingsDraft}:null;if(!s)return `<p>${escapeHtml(this.t.loading)}</p>`;
  const toggle=(id,label,value,description='')=>`<label class="setting-toggle"><input type="checkbox" data-personal-field="${id}" ${value?'checked':''}><span><strong>${escapeHtml(label)}</strong>${description?`<small>${escapeHtml(description)}</small>`:''}</span></label>`;
  return `<div class="section-head"><div><h1>${escapeHtml(this.t.personalSettings)}</h1><p>${escapeHtml(this.t.syncedAccount)}</p></div></div>${this._preferenceError?`<p class="alert">${escapeHtml(this.t.syncError)}</p>`:''}${this._settingsError?`<p class="alert" role="alert">${escapeHtml(this._settingsError)}</p>`:''}${this._settingsSaved?`<p class="notice" role="status">${escapeHtml(this.t.settingsSaved)}</p>`:''}<div class="personal-settings"><section class="dossier-section"><h2>${escapeHtml(this.t.yourExperience)}</h2><label>${escapeHtml(this.t.startPage)}<select data-personal-field="start_view"><option value="myday" ${s.start_view==='myday'?'selected':''}>${escapeHtml(this.t.myday)}</option><option value="home" ${s.start_view==='home'?'selected':''}>${escapeHtml(this.t.home)}</option></select></label>${toggle('hide_scores',this.t.hide,s.hide_scores)}<label>${escapeHtml(this.t.gridVisual)}<select data-personal-field="grid_visual">${[['portraits',this.t.gridHeadshots],['drivers',this.t.gridFullBody],['cars',this.t.gridVehicles]].map(([value,name])=>`<option value="${value}" ${s.grid_visual===value?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select></label></section><section class="dossier-section"><h2>${escapeHtml(this.t.reminders)}</h2>${toggle('reminders_enabled',this.t.enableReminders,s.reminders_enabled,this.t.reminderDescription)}<label>${escapeHtml(this.t.reminderDevice)}<select data-personal-field="reminder_device"><option value="">${escapeHtml(this.t.chooseDevice)}</option>${(this._preferences.devices||[]).map(d=>`<option value="${escapeHtml(d.id)}" ${s.reminder_device===d.id?'selected':''}>${escapeHtml(d.name)}</option>`).join('')}</select></label>${!this._preferences.devices?.length?`<p class="meta">${escapeHtml(this.t.noOwnDevices)}</p>`:''}<label>${escapeHtml(this.t.reminderLead)}<select data-personal-field="reminder_minutes">${[5,10,15,30,60].map(n=>`<option value="${n}" ${s.reminder_minutes===n?'selected':''}>${n} ${escapeHtml(this.t.minutes)}</option>`).join('')}</select></label>${toggle('quiet_enabled',this.t.quietHours,s.quiet_enabled,this.t.quietDescription)}<div class="quiet-times"><label>${escapeHtml(this.t.quietFrom)}<input type="time" data-personal-field="quiet_start" value="${s.quiet_start}"></label><label>${escapeHtml(this.t.quietUntil)}<input type="time" data-personal-field="quiet_end" value="${s.quiet_end}"></label></div><p class="meta">${escapeHtml(this.t.local)} ${escapeHtml(this.zone)}</p></section><section class="dossier-section"><h2>${escapeHtml(this.t.haCalendar)}</h2>${this._hass.user?.is_admin?toggle('calendar_shared',this.t.publishCalendar,s.calendar_shared,this.t.calendarSharedNotice):`<p>${escapeHtml(this.t.calendarAdmin)}</p>`}<p class="meta">${escapeHtml(this.t.calendarTiming)}</p></section></div><button class="cta primary" data-action="personal-save" ${this._settingsSaving?'disabled':''}>${escapeHtml(this._settingsSaving?this.t.saving:this.t.saveSettings)}</button>`;
 },
 async _savePersonalSettings(){
  if(this._settingsSaving)return;this._settingsSaving=true;this._settingsError='';this._settingsSaved=false;this._render();const userId=this._hass.user.id;
  try{const prefs=await this._hass.callWS({type:'sports_hub/personal',action:'settings',settings:this._settingsDraft||{}});if(this._hass.user.id!==userId)return;this._applyPreferences(prefs);this._settingsDraft=null;this._settingsSaved=true;this.revealed.clear();this._personalFetched=0;}
  catch(e){if(this._hass.user.id===userId)this._settingsError=e?.code==='device_required'?this.t.noOwnDevices:this.t.syncError;}
  finally{if(this._hass.user.id===userId){this._settingsSaving=false;this._render();}}
 },
};

export const personalStyles=`
.personal-hero{display:grid;grid-template-columns:1.2fr 1fr;gap:28px;padding:32px;border-radius:22px;background:linear-gradient(130deg,#1a2933,#141c26);border:1px solid var(--line);margin-bottom:26px}.personal-hero h1{font-size:clamp(32px,4vw,54px);margin:14px 0}.personal-hero p{color:var(--muted);line-height:1.65}.personal-actions{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}.personal-next>.game{margin-top:14px}.personal-section{margin:32px 0}.followed-strip{display:flex;gap:12px;overflow-x:auto;padding:10px 0}.followed-card{display:flex;align-items:center;gap:12px;min-width:190px;background:#182230;color:var(--text);padding:14px 18px;border:1px solid var(--line);border-radius:14px;text-align:left}.followed-card .profile-logo{width:42px;height:42px;padding:5px}.followed-card span{font-weight:650}.calendar-layout{display:grid;grid-template-columns:1.5fr 1fr;gap:24px;align-items:start}.calendar-month{background:#141d29;padding:20px;border:1px solid var(--line);border-radius:18px}.calendar-controls{display:flex;align-items:center;gap:10px;margin-bottom:22px}.calendar-controls h2{flex:1;font-size:20px;margin:0;text-align:center}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.calendar-weekday{text-align:center;color:var(--muted);font-size:12px;padding:10px 0}.calendar-day{position:relative;min-height:95px;padding:10px;text-align:left;background:#202b3a;border:1px solid transparent;border-radius:8px;color:#edf3f9;overflow:hidden}.calendar-day.selected{border-color:var(--accent);background:#33422e}.calendar-day.today>b{color:var(--accent)}.calendar-day.outside{opacity:.45}.calendar-day small{display:block;font-size:10px;line-height:1.5;margin-top:10px;overflow:hidden;max-height:30px}.day-count{float:right;border-radius:20px;background:var(--accent);color:#101807;font-size:10px;padding:3px 5px}.calendar-events{display:grid;gap:16px}.personal-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:24px 0}.personal-settings .dossier-section{margin:0}.personal-settings label:not(.setting-toggle){display:flex;flex-direction:column;gap:9px;margin:18px 0;color:var(--muted);font-size:13px}.personal-settings select,.personal-settings input[type=time]{width:100%;padding:12px;border-radius:8px;background:#101a27;color:#edf3f9;border:1px solid #3c495b;font:inherit;box-sizing:border-box}.setting-toggle{display:flex;gap:13px;align-items:flex-start;margin:22px 0;cursor:pointer}.setting-toggle input{width:20px;height:20px;flex:none;accent-color:var(--accent)}.setting-toggle strong{font-size:14px}.setting-toggle small{display:block;margin-top:8px;line-height:1.6;color:var(--muted);font-size:12px}.quiet-times{display:grid;grid-template-columns:1fr 1fr;gap:16px}.personal-settings+.cta{margin-bottom:24px}@media(max-width:850px){.personal-hero,.calendar-layout,.personal-settings{grid-template-columns:1fr}.personal-hero{padding:22px}.calendar-day{min-height:68px;padding:7px}.calendar-day small{display:none}.calendar-controls{flex-wrap:wrap}.calendar-controls h2{font-size:17px}.calendar-month{padding:12px}.calendar-grid{gap:4px}}
`;
