import {escapeHtml as esc, safeUrl, dateKey, shiftDate, filterEvents, isFreshLive, scoreDisplay} from './model.js';
import {styles} from './style.js';
import {dossierStyles} from './dossier-style.js';
import {dossierTabs} from './dossier-model.js';
import {dossierMethods} from './dossier.js';
import {f1DossierMethods} from './f1-dossier.js';
import './dossier-i18n.js';
import './match-i18n.js';
import {matchMethods,matchReference} from './match-center.js';
import {matchStyles} from './match-style.js';
import {words, languageCode} from './i18n.js';
import {colorValue, contrastColor, profileFromParticipant, profileFromLeague, dashboardEvents, discoverProfiles, approvedProfile} from './dashboards.js';



const paths = {
  tables:'M4 4h16v16H4z M4 9h16 M4 14h16 M9 4v16',competitionsTab:'M7 3h10v5a5 5 0 0 1-10 0z M7 5H3v3a4 4 0 0 0 4 4 M17 5h4v3a4 4 0 0 1-4 4 M12 13v6 M8 21h8',squad:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a8 8 0 0 1 16 0v3 M3 4a3 3 0 0 0 0 6 M21 4a3 3 0 0 1 0 6',news:'M4 3h16v18H4z M8 7h8 M8 11h3 M14 11h2 M8 15h8 M8 18h8',championship:'M4 21V11h4v10 M10 21V3h4v18 M16 21V7h4v14',raceControl:'M5 22V3 M5 3h14l-3 5 3 5H5',strategy:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  hub:'M4 7h16v10H4z M8 4v3 M16 4v3 M8 11v2 M16 11v2 M11 10v4 M4 20h16',
  home:'M3 10l9-7 9 7v10H3z M9 20v-7h6v7',
  live:'M4 12h3l3-8 4 16 3-8h3',schedule:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',
  results:'M7 3h10v5a5 5 0 0 1-10 0z M7 5H3v3a4 4 0 0 0 4 4 M17 5h4v3a4 4 0 0 1-4 4 M12 13v6 M8 21h8',
  star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  leagues:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  arrow:'M5 12h14 M13 6l6 6-6 6',left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',close:'M6 6l12 12 M6 18L18 6',menu:'M4 6h16 M4 12h16 M4 18h16',
  soccer:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 7l5 4-2 6H9l-2-6z M12 2v5 M2 10l5 1 M22 10l-5 1 M6 20l3-3 M18 20l-3-3',
  basketball:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2v20 M5 5c9 2 12 9 14 14 M19 5C10 7 7 14 5 19',
  football:'M3 21C-2 8 8-2 21 3c5 13-5 23-18 18 M7 17L17 7 M9 12l3 3 M12 9l3 3',
  hockey:'M3 4l9 14h9v3H11L2 7 M16 9h5v3h-5z',
  baseball:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M5 5c6 4 6 10 0 14 M19 5c-6 4-6 10 0 14',
  tennis:'M6 18l-4 4 M8 16a7 9 40 1 0-1-1 M10 5l7 7 M7 9l7 7 M15 3L6 12 M19 6L9 17',
  racing:'M5 22V3 M5 3c5-4 9 4 15 0v11c-6 4-10-4-15 0 M10 3v11 M15 4v11 M5 8c5-4 9 4 15 0',
  golf:'M6 21V3l13 5-13 5 M3 21h13',mma:'M5 13V7l2-2 3 2 3-3 3 1 3 3v8l-4 5H8z',
  'australian-football':'M3 21C-2 8 8-2 21 3c5 13-5 23-18 18 M7 17L17 7',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.hub}"/></svg>`;

class SportsHubPanel extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:'open'});
    this.view='home'; this.sport='all'; this.league='all'; this.search=''; this.date=''; this.limit=24;
    this.favorites=[]; this.favoriteNames={}; this.hideScores=false; this.revealed=new Set();
    this.dashboards=[];this.sidebarDashboards=[];this._activeDashboardKey=null;this._proposal=null;this._busy=false;
    this._onVisibility=()=>{if(!document.hidden)this._fetch();};
    this.shadowRoot.addEventListener('click', e=>this._click(e));
    this.shadowRoot.addEventListener('change', e=>this._change(e));
    this.shadowRoot.addEventListener('input', e=>this._input(e));
    this.shadowRoot.addEventListener('compositionstart',()=>{this._composing=true;});
    this.shadowRoot.addEventListener('compositionend',e=>{this._composing=false;this._input(e);});
    this.shadowRoot.addEventListener('focusout',event=>{if(this._renderPending&&!this.shadowRoot.contains(event.relatedTarget))setTimeout(()=>{if(this.isConnected&&!this.shadowRoot.activeElement)this._render();},0);});
    this.shadowRoot.addEventListener('keydown',e=>this._key(e));
    this.shadowRoot.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement){e.target.hidden=true;}},true);
  }
  set hass(value) {
    const previous=this._hass; this._hass=value;
    const oldLang=this.lang;this.lang=languageCode(value?.language);
    if(previous?.user?.id!==value?.user?.id){this.dashboards=[];this.sidebarDashboards=[];this._activeDashboardKey=null;this._proposal=null;this._data=null;this._detail=null;this._dossiers={};this._matches={};this._nativeCards=new Map();this._f1Generation=(this._f1Generation||0)+1;this.revealed.clear();}
    if(previous?.user?.id!==value?.user?.id || !this._storageKey)this._loadPreferences();
    if(this.isConnected&&(oldLang!==this.lang||previous?.user?.id!==value?.user?.id))this._render();
    if(!this._data && this.isConnected)this._fetch();
    for(const {card} of this._nativeCards?.values()||[])card.hass=value;
  }
  set panel(value) {const changed=this._panel?.config?.dashboard?.key!==value?.config?.dashboard?.key;const initial=!this._panel;this._panel=value;this._loadPreferences();if(changed){this.view='home';this._activeDashboardKey=null;this.allDates=!!value?.config?.dashboard;}if(this.isConnected&&(changed||initial))this._render();}
  set narrow(value) {this._narrow=value;}
  connectedCallback() {
    this._timer=setInterval(()=>{if(!document.hidden)this._fetch();},30000);
    document.addEventListener('visibilitychange',this._onVisibility);this._render();this._fetch();
  }
  disconnectedCallback() {clearInterval(this._timer);clearTimeout(this._searchTimer);document.removeEventListener('visibilitychange',this._onVisibility);}
  get t(){return words[this.lang || 'en'];}
  get activeDashboard(){return this._panel?.config?.dashboard||approvedProfile(this.dashboards,this._activeDashboardKey);}
  get zone(){return this._data?.time_zone || this._hass?.config?.time_zone || 'UTC';}
  get now(){return this._panel?.config?.preview_now ? Date.parse(this._panel.config.preview_now) : Date.now();}
  _loadPreferences(){
    if(!this._hass?.user?.id || !this._panel?.config?.entry_id)return;
    const key=`sports-hub:${this._panel.config.entry_id}:${this._hass.user.id}`;
    if(key===this._storageKey)return;
    this._storageKey=key;this.favorites=[];this.favoriteNames={};this.hideScores=false;
    try{const saved=JSON.parse(localStorage.getItem(key)||'{}');this.favorites=Array.isArray(saved.favorites)?saved.favorites.filter(v=>typeof v==='string').slice(0,200):[];this.favoriteNames=saved.names && typeof saved.names==='object'?saved.names:{};this.hideScores=saved.hideScores===true;}catch{}
  }
  _savePreferences(){try{if(this._storageKey)localStorage.setItem(this._storageKey,JSON.stringify({favorites:this.favorites,names:this.favoriteNames,hideScores:this.hideScores}));}catch{}}
  async _fetch(){
    if(!this._hass || this._fetching || !this.isConnected)return;
    this._fetching=true;const userId=this._hass.user?.id;
    try{const [data,profiles]=await Promise.all([this._hass.callWS({type:'sports_hub/data'}),this._hass.callWS({type:'sports_hub/dashboards'}).catch(()=>null)]);if(!this.isConnected||this._hass.user?.id!==userId)return;this._data=data;this._error=false;if(profiles){this.dashboards=profiles.dashboards||[];this.sidebarDashboards=profiles.sidebar||[];this._profileError=false;}else this._profileError=true;if(!this.date)this.date=dateKey(this.now,this.zone);}
    catch{this._error=true;}finally{this._fetching=false;if(this.isConnected){this._render();if(this._hass.user?.id!==userId)this._fetch();}}
  }
  _format(date,options={}){if(!date || !Number.isFinite(Date.parse(date)))return this.t.unknown;return new Intl.DateTimeFormat(this.lang,{timeZone:this.zone,...options}).format(new Date(date));}
  _hidden(e){return this.hideScores&&!this.revealed.has(e.id);}
  _status(e){if(e.stale || (e.state==='live'&&!isFreshLive(e,this.now)))return this.t.stale;if(this._hidden(e))return this.t.scoreHidden;if(isFreshLive(e,this.now))return `LIVE${e.clock&&e.clock!=='0:00'?' · '+e.clock:''}`;return this.t[e.state]||e.status;}
  _logo(p){const url=safeUrl(p.logo);return url?`<img class="team-logo" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="team-logo initials" aria-hidden="true">${esc(p.abbreviation||p.name.split(/\s+/).map(s=>s[0]).slice(0,3).join(''))}</span>`;}
  _team(p,e,leader=false){const favorite=this.favorites.includes(p.key);const hidden=this._hidden(e);return `<div class="team ${!hidden&&p.winner?'winner':''}">${leader?`<span class="rank">${esc(p.order===999?'–':p.order)}</span>`:''}${this._logo(p)}<div class="team-name">${esc(p.name)}${!hidden&&p.record&&!leader?`<small>${esc(p.record)}</small>`:''}</div><span class="team-score ${e.sport==='tennis'?'tennis':''}">${esc(scoreDisplay(p,e,hidden))}</span>${p.key?`<button class="star ${favorite?'active':''}" data-action="favorite" data-value="${esc(p.key)}" data-name="${esc(p.name)}" aria-label="${esc((favorite?this.t.removeFavorite:this.t.addFavorite)+' · '+p.name)}" aria-pressed="${favorite}">${icon('star')}</button>`:''}</div>`;}
  _game(e,expanded=false){
    const fresh=isFreshLive(e,this.now),hidden=this._hidden(e),leader=e.format==='leaderboard';
    const participants=expanded?e.participants:e.participants.slice(0,leader?3:2);
    let body;
    if(leader){body=`<div class="event-title">${esc(e.name)}</div><div class="event-sub">${esc(e.subtitle)}</div>${hidden?`<p class="meta">${esc(this.t.scoreHidden)}</p>`:e.state==='scheduled'?`<p class="meta">${esc(this._format(e.date,{weekday:'long',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</p>`:`<div class="leader">${participants.map(p=>this._team(p,e,true)).join('')}</div>`}`;}
    else body=participants.length?participants.map(p=>this._team(p,e)).join(''):`<div class="event-title">${esc(e.name)}</div>`;
    return `<article class="game ${fresh?'live':''}" data-event="${esc(e.id)}"><div class="game-top"><div class="league-label">${icon(e.sport)}<span>${esc(e.league)}</span><button class="star" data-action="league-favorite" data-value="${esc(e.league_id)}" aria-label="${esc((this.favorites.includes('league:'+e.league_id)?this.t.removeFavorite:this.t.addFavorite)+' · '+e.league)}" aria-pressed="${this.favorites.includes('league:'+e.league_id)}">${icon('star')}</button></div><span class="status ${fresh&&!hidden?'live':''} ${e.stale?'stale':''}" title="${esc(this._status(e))}">${esc(this._status(e))}</span></div>${body}<div class="game-footer"><span>${esc(e.time_confirmed?this._format(e.date,{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):this.t.timeTbd)}${e.subtitle&&!leader?' · '+esc(e.subtitle):''}</span>${!expanded?`<button data-action="details" data-value="${esc(e.id)}" aria-label="${esc(this.t.details+' · '+e.name)}">${esc(this.t.details)} ↗</button>`:''}</div></article>`;
  }
  _hero(events){
    const live=events.filter(e=>isFreshLive(e,this.now));
    const upcoming=events.filter(e=>e.state==='scheduled'&&Date.parse(e.date)>=this.now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    const focus=live[0]||upcoming[0];const today=dateKey(this.now,this.zone);
    return `<div class="hero"><section class="intro"><div class="eyebrow">${esc(this._format(new Date(this.now).toISOString(),{weekday:'long',day:'numeric',month:'long'}))} · SPORTS HUB</div><h1>${this.t.hero}</h1><p>${esc(this.t.intro)}</p><div class="metrics"><div class="metric"><strong>${filterEvents(events,{date:today,timeZone:this.zone,now:this.now}).length}</strong><small>${esc(this.t.eventsToday)}</small></div><div class="metric"><strong style="color:var(--aqua)">${live.length}</strong><small>${esc(this.t.liveNow)}</small></div><div class="metric"><strong>${this._data.leagues.length}</strong><small>${esc(this.t.competitions)}</small></div></div></section><section class="spotlight"><div class="spotlight-top"><span class="eyebrow">${esc(focus&&isFreshLive(focus,this.now)?this.t.spotlight:this.t.nextUp)}</span>${icon(focus?.sport||'schedule')}</div>${focus?`<div><h2>${esc(focus.format==='match'&&focus.participants.length===2?focus.participants.map(p=>p.short_name).join(' vs '):focus.name)}</h2><p>${esc(focus.league)}${focus.subtitle?' · '+esc(focus.subtitle):''}<br>${esc(this._format(focus.date,{weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</p></div><button class="cta primary" data-action="details" data-value="${esc(focus.id)}">${esc(this.t.viewEvent)} ${icon('arrow')}</button>`:`<div><h2>${esc(this.t.noEvents)}</h2><p>${esc(this.t.noEventsText)}</p></div><button class="cta" data-action="view" data-value="leagues">${esc(this.t.leagues)} ${icon('arrow')}</button>`}</section></div>`;
  }
  _filters(){
    const sports=this._data.sports.filter(s=>this._data.leagues.some(l=>l.sport===s.id));
    const leagues=this._data.leagues.filter(l=>this.sport==='all'||l.sport===this.sport);
    return `<div class="sport-filters" aria-label="${esc(this.t.all)}"><button class="chip ${this.sport==='all'?'active':''}" data-action="sport" data-value="all">${icon('leagues')}${esc(this.t.all)}</button>${sports.map(s=>`<button class="chip ${this.sport===s.id?'active':''}" data-action="sport" data-value="${esc(s.id)}">${icon(s.id)}${esc(this.t.sports?.[s.id]||s.name)}</button>`).join('')}</div><div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" autocomplete="off" value="${esc(this.search)}" placeholder="${esc(this.t.search)}" aria-label="${esc(this.t.search)}"></label><select id="league" aria-label="${esc(this.t.leagues)}"><option value="all">${esc(this.t.allLeagues)}</option>${leagues.map(l=>`<option value="${esc(l.id)}" ${this.league===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><button class="spoiler" data-action="spoiler" aria-pressed="${this.hideScores}">${icon('eye')}${esc(this.hideScores?this.t.show:this.t.hide)}</button>${!['live','favorites'].includes(this.view)?`<div class="date-nav"><button class="icon-button" data-action="date-shift" data-value="-1" aria-label="${esc(this.t.previousDay)}">${icon('left')}</button><input id="date" type="date" value="${esc(this.date)}" min="${esc(dateKey(this._data.window_start,this.zone))}" max="${esc(dateKey(Date.parse(this._data.window_end)-1,this.zone))}" aria-label="${esc(this.t.date)}"><button class="icon-button" data-action="date-shift" data-value="1" aria-label="${esc(this.t.nextDay)}">${icon('right')}</button><button class="chip" data-action="today">${esc(this.t.today)}</button><button class="chip ${this.allDates?'active':''}" data-action="all-dates" aria-pressed="${!!this.allDates}">${esc(this.t.allDates)}</button></div>`:''}</div>`;
  }
  _leagueDirectory(){
    return `<div class="section-head"><div><h1>${esc(this.t.leagues)}</h1><p>${esc(this.t.leagueIntro)}</p></div>${this._hass?.user?.is_admin?`<a class="cta" href="/config/integrations/integration/sports_hub">${esc(this.t.manage)} ↗</a>`:''}</div>${this._data.sports.map(s=>{const leagues=this._data.leagues.filter(l=>l.sport===s.id);if(!leagues.length)return '';return `<h2 class="league-group-title">${esc(this.t.sports?.[s.id]||s.name)} · ${leagues.length}</h2><div class="league-grid">${leagues.map(l=>`<article class="league-item"><div class="league-symbol">${safeUrl(l.logo)?this._logo(l):icon(l.sport)}</div><div class="league-info"><strong>${esc(l.name)}</strong><small>${l.error?esc(this.t.stale)+` · ${l.failed_days}`:l.loading?esc(this.t.loading):l.event_count?`${l.event_count} ${esc(this.t.events)}`:esc(this.t.noFixtures)}${l.partial?' · '+esc(this.t.partial):''}</small></div><button class="star ${this.favorites.includes('league:'+l.id)?'active':''}" data-action="league-favorite" data-value="${esc(l.id)}" aria-label="${esc((this.favorites.includes('league:'+l.id)?this.t.removeFavorite:this.t.addFavorite)+' · '+l.name)}" aria-pressed="${this.favorites.includes('league:'+l.id)}">${icon('star')}</button><button class="icon-button" data-action="league" data-value="${esc(l.id)}" aria-label="${esc(l.name)}">${icon('right')}</button></article>`).join('')}</div>`;}).join('')}`;
  }
  _empty(type){const title=type==='favorites'?this.t.noFavorites:type==='live'?this.t.noLive:this.t.noEvents;const message=type==='favorites'?this.t.noFavoritesText:type==='live'?this.t.noLiveText:this.t.noEventsText;return `<div class="empty"><div class="empty-icon">${icon(type==='favorites'?'star':type==='live'?'live':'schedule')}</div><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;}
  _modalHtml(){const e=this._profileEvents(this.activeDashboard).find(e=>e.id===this._detail);if(!e)return '';if(matchReference(e))return this._matchCenter(e);const url=safeUrl(e.url);return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="event-title"><div class="modal-head"><div><div class="eyebrow">${esc(e.league)}</div><h2 id="event-title">${esc(e.name)}</h2></div><button class="icon-button" data-action="close" aria-label="${esc(this.t.close)}">${icon('close')}</button></div>${this._game(e,true)}<dl class="modal-details"><div><dt>${esc(this.t.start)}</dt><dd>${esc(e.time_confirmed?this._format(e.date,{dateStyle:'medium',timeStyle:'short'}):this.t.timeTbd)}</dd></div><div><dt>${esc(this.t.venue)}</dt><dd>${esc(e.venue||this.t.unknown)}</dd></div><div><dt>${esc(this.t.updated)}</dt><dd>${esc(this._format(e.updated_at,{dateStyle:'medium',timeStyle:'short'}))}</dd></div><div><dt>${esc(this.t.source)}</dt><dd>ESPN</dd></div></dl><div class="modal-actions">${this._hidden(e)?`<button class="cta primary" data-action="reveal" data-value="${esc(e.id)}">${esc(this.t.reveal)}</button>`:''}${url?`<a class="cta" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(this.t.openSource)} ↗</a>`:''}${e.league_id==='racing:f1'&&this._hass?.panels?.['dashboard-f1']?`<a class="cta" href="/dashboard-f1">${esc(this.t.f1)} ↗</a>`:''}</div>${this._hidden(e)?`<p class="meta">${esc(this.t.spoilerWarning)}</p>`:''}</section></div>`;}
  _input(event){
    if(event.target.id==='dashboard-name'&&this._proposal){this._proposal.name=event.target.value;return;}
    if(event.target.id!=='search')return;
    // Capture synchronously: composed events are retargeted to the host after dispatch.
    this.search=event.target.value;this.limit=24;clearTimeout(this._searchTimer);
    if(!this._composing)this._searchTimer=setTimeout(()=>this._render(),180);
  }
  _findProfile(key){return approvedProfile(this.dashboards,key)||discoverProfiles(this._data).find(p=>p.key===key);}
  _propose(profile){if(!profile)return;this._detail=null;this._proposal={...profile,sidebar:false};this._actionError='';this._render();this.shadowRoot.querySelector('[data-action="dashboard-cancel"]')?.focus();}
  async _dashboardRequest(payload){
    this._busy=true;this._actionError='';
    try{const result=await this._hass.callWS({type:'sports_hub/dashboards',...payload});this.dashboards=result.dashboards||[];this.sidebarDashboards=result.sidebar||[];return true;}
    catch(error){this._actionError=this.t.errorsByCode?.[error?.code]||this.t.saveError;return false;}
    finally{this._busy=false;}
  }
  async _approve(){
    if(!this._proposal?.name.trim())return;
    const draft={...this._proposal},sidebar=draft.sidebar;delete draft.sidebar;
    this._busy=true;this._render();
    if(!await this._dashboardRequest({action:'save',dashboard:draft,confirmed:true})){this._render();return;}
    if(sidebar&&!await this._dashboardRequest({action:'publish',key:draft.key,confirmed:true})){this._render();return;}
    this._proposal=null;this._activeDashboardKey=draft.key;this.view='home';this.sport='all';this.league='all';this.search='';this.allDates=true;
    this._render();this.shadowRoot.querySelector('.shell').scrollTop=0;
  }
  _profileLogo(profile){const url=safeUrl(profile.logo);return url?`<img class="profile-logo" src="${esc(url)}" alt="${esc(profile.name)}" referrerpolicy="no-referrer">`:`<span class="profile-logo placeholder-logo">${icon(profile.sport)}</span>`;}
  _profileCard(profile,pending=false,sharedOnly=false){
    const shared=this.sidebarDashboards.find(p=>p.key===profile.key);
    return `<article class="profile-card" style="--club:${colorValue(profile.color)};--club-secondary:${colorValue(profile.alternate_color,'#ffffff')};--club-contrast:${contrastColor(profile.color)}"><div class="profile-card-top">${this._profileLogo(profile)}<div><small>${esc(profile.kind==='league'?this.t.leagueDashboard:this.t.teamDashboard)}</small><h2>${esc(profile.name)}</h2><span class="meta">${esc(pending?this.t.awaitingApproval:this.t.approved)}</span></div></div><div class="profile-actions">${sharedOnly?'':pending?`<button class="cta primary" data-action="dashboard-preview" data-value="${esc(profile.key)}">${esc(this.t.previewDashboard)} →</button>`:`<button class="cta primary" data-action="dashboard-open" data-value="${esc(profile.key)}">${esc(this.t.openDashboard)} →</button><button class="cta" data-action="dashboard-preview" data-value="${esc(profile.key)}">${esc(this.t.customize)}</button><button class="cta" data-action="dashboard-remove" data-value="${esc(profile.key)}" aria-label="${esc(this.t.removeDashboard+' · '+profile.name)}">${esc(this.t.remove)}</button>`}${shared&&!pending?`<a class="cta" href="/${esc(shared.path)}">${esc(this.t.openSidebar)} ↗</a>${this._hass?.user?.is_admin?`<button class="cta" data-action="sidebar-remove" data-value="${esc(profile.key)}">${esc(this.t.removeSidebar)}</button>`:''}`:''}</div></article>`;
  }
  _dashboardDirectory(){
    const sharedOnly=this.sidebarDashboards.filter(p=>!approvedProfile(this.dashboards,p.key));
    const candidates=discoverProfiles(this._data).filter(p=>this.favorites.includes(p.kind==='league'?p.key:p.target)&&!approvedProfile(this.dashboards,p.key));
    return `<div class="section-head"><div><h1>${esc(this.t.myDashboards)}</h1><p>${esc(this.t.dashboardIntro)}</p></div></div>${this._profileError?`<div class="alert" role="alert">${esc(this.t.saveError)}</div>`:''}<div class="profile-grid">${this.dashboards.map(p=>this._profileCard(p)).join('')||`<div class="empty"><h3>${esc(this.t.noDashboards)}</h3><p>${esc(this.t.noDashboardsText)}</p></div>`}</div>${candidates.length?`<h2 class="league-group-title">${esc(this.t.awaitingApproval)}</h2><div class="profile-grid">${candidates.map(p=>this._profileCard(p,true)).join('')}</div>`:''}${sharedOnly.length?`<h2 class="league-group-title">${esc(this.t.sharedDashboards)}</h2><div class="profile-grid">${sharedOnly.map(p=>this._profileCard(p,false,true)).join('')}</div>`:''}<p class="meta">${esc(this.t.dashboardStorage)}</p>`;
  }
  _discovery(){
    if(!String(this.search||'').trim())return '<div class="search-discovery"></div>';
    const results=discoverProfiles(this._data,this.search).slice(0,10);
    return `<section class="search-discovery" aria-label="${esc(this.t.matchingTeams)}"><div class="section-head"><div><h2>${esc(this.t.matchingTeams)}</h2><p>${esc(this.t.discoveryHint)}</p></div></div><div class="discover-grid">${results.map(p=>{const favorite=this.favorites.includes(p.kind==='league'?p.key:p.target);return `<article class="discover-item">${this._profileLogo(p)}<div><strong>${esc(p.name)}</strong><small>${esc(p.context||(p.kind==='league'?this.t.leagueDashboard:this.t.teamDashboard))}</small></div><button class="star ${favorite?'active':''}" data-action="${p.kind==='league'?'league-favorite':'favorite'}" data-value="${esc(p.target)}" data-name="${esc(p.name)}" aria-label="${esc((favorite?this.t.removeFavorite:this.t.addFavorite)+' · '+p.name)}" aria-pressed="${favorite}">${icon('star')}</button><button class="cta" data-action="${approvedProfile(this.dashboards,p.key)?'dashboard-open':'dashboard-preview'}" data-value="${esc(p.key)}">${esc(approvedProfile(this.dashboards,p.key)?this.t.openDashboard:this.t.previewDashboard)}</button></article>`;}).join('')||`<p class="meta">${esc(this.t.noMatches)}</p>`}</div></section>`;
  }
  _dashboardHero(profile,events){
    const live=events.filter(e=>isFreshLive(e,this.now));
    const next=events.filter(e=>e.state==='scheduled'&&Date.parse(e.date)>=this.now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
    const focus=live[0]||next;
    const finished=events.filter(e=>e.state==='finished').length;
    return `<div class="dashboard-hero"><section class="club-banner">${this._profileLogo(profile)}<div><div class="eyebrow">${esc(profile.kind==='league'?this.t.leagueDashboard:this.t.teamDashboard)}</div><h1>${esc(profile.name)}</h1><p>${esc(this.t.clubIntro)}</p><div class="metrics"><div class="metric"><strong>${events.filter(e=>e.state==='scheduled').length}</strong><small>${esc(this.t.upcoming)}</small></div><div class="metric"><strong>${live.length}</strong><small>${esc(this.t.liveNow)}</small></div><div class="metric"><strong>${finished}</strong><small>${esc(this.t.results)}</small></div></div></div></section><section class="club-next"><div class="eyebrow">${esc(live.length?this.t.spotlight:this.t.nextUp)}</div>${focus?`<h2>${esc(focus.name)}</h2><p>${esc(focus.league)}<br>${esc(this._format(focus.date,{dateStyle:'medium',timeStyle:'short'}))}</p><button class="cta primary" data-action="details" data-value="${esc(focus.id)}">${esc(this.t.viewEvent)} →</button>`:`<h2>${esc(this.t.noUpcoming)}</h2><p>${esc(this.t.windowHint)}</p>`}</section></div><p class="meta window-hint">${esc(this.t.loadedWindow)}: ${esc(this._format(this._data.window_start,{dateStyle:'medium'}))} – ${esc(this._format(new Date(Date.parse(this._data.window_end)-1).toISOString(),{dateStyle:'medium'}))}</p>`;
  }
  _proposalHtml(){
    const p=this._proposal;
    return `<div class="modal-backdrop"><section class="modal approval-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-preview-title" style="--club:${colorValue(p.color)};--club-secondary:${colorValue(p.alternate_color,'#ffffff')};--club-contrast:${contrastColor(p.color)}"><div class="modal-head"><div><div class="eyebrow">${esc(this.t.preview)}</div><h2 id="dashboard-preview-title">${esc(this.t.approveTitle)}</h2></div><button class="icon-button" data-action="dashboard-cancel" aria-label="${esc(this.t.close)}">${icon('close')}</button></div><div class="club-preview">${this._profileLogo(p)}<div><h3>${esc(p.name)}</h3><p>${esc(dossierTabs(p).map(v=>this.t[v]).join(' · '))}</p></div></div><p class="approval-copy">${esc(this.t.approvalCopy)}</p><div class="dashboard-form"><label>${esc(this.t.dashboardName)}<input id="dashboard-name" type="text" maxlength="100" value="${esc(p.name)}"></label><div class="color-fields"><label>${esc(this.t.primaryColor)}<input id="dashboard-color" type="color" value="${colorValue(p.color)}"></label><label>${esc(this.t.secondaryColor)}<input id="dashboard-secondary" type="color" value="${colorValue(p.alternate_color,'#ffffff')}"></label></div>${!p.logo?`<p class="meta">${esc(this.t.noLogo)}</p>`:''}${this._hass?.user?.is_admin?`<label class="sidebar-choice"><input id="dashboard-sidebar" type="checkbox" ${p.sidebar?'checked':''}><span>${esc(this.t.alsoSidebar)}<small>${esc(this.t.sidebarVisibility)}</small></span></label>`:`<p class="meta">${esc(this.t.adminSidebar)}</p>`}</div>${this._actionError?`<div class="alert" role="alert">${esc(this._actionError)}</div>`:''}<div class="modal-actions"><button class="cta" data-action="dashboard-cancel" ${this._busy?'disabled':''}>${esc(this.t.later)}</button><button class="cta primary" data-action="dashboard-approve" ${this._busy?'disabled':''}>${esc(this._busy?this.t.saving:this.t.approveDashboard)}</button></div></section></div>`;
  }
  _render(){
    const active=this.shadowRoot.activeElement;const focused=active?.id;const selection=active?.type==='search'?[active.selectionStart,active.selectionEnd]:null;
    const buttonFocus=active?.dataset?.action?{action:active.dataset.action,value:active.dataset.value}:null;
    const modalScroll=this.shadowRoot.querySelector('.modal')?.scrollTop||0;
    const scroll=this.shadowRoot.querySelector('.shell')?.scrollTop||0;
    const filterScroll=this.shadowRoot.querySelector('.sport-filters')?.scrollLeft||0;
    const navScroll=this.shadowRoot.querySelector('.nav')?.scrollLeft||0;
    const profile=this.activeDashboard;const events=this._profileEvents(profile);const live=events.filter(e=>isFreshLive(e,this.now)).length;
    let content='';
    if(!this._data)content=`<div class="empty"><div class="empty-icon ${this._error?'':'loading'}">${icon('hub')}</div><h3>${esc(this._error?this.t.offline:this.t.loading)}</h3><p>${esc(this.t.loadingText)}</p>${this._error?`<button class="cta" data-action="retry">${esc(this.t.retry)}</button>`:''}</div>`;
    else if(profile)content=this._dossier(profile,events);
    else if(this.view==='leagues')content=this._leagueDirectory();
    else if(this.view==='dashboards')content=this._dashboardDirectory();
    else{
      const filtered=filterEvents(events,{view:this.view,sport:this.sport,league:this.league,search:this.search,date:this.allDates?null:this.date,timeZone:this.zone,favorites:this.favorites,now:this.now});
      const title=this.view==='home'?(profile?this.t.allEvents:this.t.today):this.t[this.view];
      content=(profile?this._dashboardHero(profile,events):(this.view==='home'?this._hero(events):''))+`<div class="section-head"><div class="section-label"><h2>${esc(title)}</h2><span class="count">${filtered.length}</span></div>${this.view==='favorites'?`<span class="meta">${this.favorites.length} ${esc(this.t.favoriteList)}</span>`:''}</div>`+this._filters();
      if(this.view==='favorites'&&this.favorites.length)content+=`<div class="sport-filters">${this.favorites.map(key=>`<button class="chip" data-action="favorite" data-value="${esc(key)}" aria-label="${esc(this.t.remove+' · '+(this.favoriteNames[key]||key))}">${icon('star')}${esc(this.favoriteNames[key]||key)} ×</button>`).join('')}</div>`;
      content+=this._discovery()+`<div class="games">${filtered.length?filtered.slice(0,this.limit).map(e=>this._game(e)).join(''):this._empty(this.view)}</div>${filtered.length>this.limit?`<button class="cta show-more" data-action="more">${esc(this.t.more)} · ${filtered.length-this.limit}</button>`:''}`;
    }
    const sourceError=!profile&&this._data?.leagues.some(l=>l.error),partial=!profile&&this._data?.leagues.some(l=>l.partial);
    const markup=`<style>${styles}${dossierStyles}${matchStyles}</style><div class="shell ${profile?'branded':''}" ${profile?`style="--club:${colorValue(profile.color)};--club-secondary:${colorValue(profile.alternate_color,'#ffffff')};--club-contrast:${contrastColor(profile.color)}"`:''}><header class="topbar"><div class="top-inner"><button class="icon-button" data-action="menu" aria-label="${esc(this.t.menu)}">${icon('menu')}</button><div class="brand"><div class="brandmark">${icon('hub')}</div>SPORTS<span>HUB</span></div>${this._panel?.config?.preview?`<span class="badge-demo">${esc(this.t.demo)}</span>`:''}<div class="top-gap"></div><div class="meta"><div class="connection"><i class="dot ${this._error||sourceError?'error':''}"></i>${esc(this._error?this.t.offline:sourceError?this.t.stale:this.t.fresh)}</div><div>${esc(this.zone)}</div></div><button class="icon-button" data-action="view" data-value="favorites" aria-label="${esc(this.t.favorites)}">${icon('star')}</button></div></header><main class="main">${profile?`<div class="dashboard-back">${this._panel?.config?.dashboard?`<a class="cta" href="/sports-hub">← Sports Hub</a>`:`<button class="cta" data-action="dashboard-back">← ${esc(this.t.myDashboards)}</button>`}</div>`:''}<nav class="nav" aria-label="Sports Hub">${(profile?dossierTabs(profile):['home','live','schedule','results','favorites','leagues','dashboards']).map(view=>`<button class="${view===this.view?'active':''}" data-action="view" data-value="${view}" ${view===this.view?'aria-current="page"':''}>${icon(view==='favorites'?'star':view==='dashboards'?'leagues':view)}${esc(this.t[view])}${view==='live'&&profile?.target!=='racing:f1'?`<span class="count">${live}</span>`:''}</button>`).join('')}</nav>${this._error&&this._data?`<div class="alert" role="status">${esc(this.t.offline)} · ${esc(this.t.stale)}</div>`:''}${sourceError?`<div class="alert" role="status">${esc(this.t.errors)}</div>`:''}${partial?`<div class="alert">${esc(this.t.partial)}</div>`:''}${!profile&&this._data?.loading?`<p class="meta" role="status">${esc(this.t.backfill)} ${this._data.loaded_slices}/${this._data.total_slices}</p>`:''}${this._actionError?`<div class="alert" role="alert">${esc(this._actionError)}</div>`:''}${content}<footer class="footer"><div>${esc(this.t.footer)}<br>${esc(this.t.local)} ${esc(this.zone)} · Sports Hub ${esc(this._data?.version||this._panel?.config?.version||'0.3.0')}</div><div><a href="https://github.com/maikelfuhrmann/ha-sports-hub" target="_blank" rel="noopener noreferrer">GitHub ↗</a> · <a href="https://paypal.me/maikeltimo" target="_blank" rel="noopener noreferrer">${esc(this.t.support)} ↗</a></div></footer></main></div>${this._proposal?this._proposalHtml():this._detail&&this._data?this._modalHtml():''}`;
    // Keep the actual input node mounted while typing, including IME and mobile keyboards.
    if(focused==='search'&&!this._proposal){
      const template=document.createElement('template');template.innerHTML=markup;
      for(const selector of ['.games','.search-discovery','.section-head','.connection']){const old=this.shadowRoot.querySelector(selector),fresh=template.content.querySelector(selector);if(old&&fresh)old.replaceWith(fresh);}
      this.shadowRoot.querySelector('.show-more')?.remove();const more=template.content.querySelector('.show-more');if(more)this.shadowRoot.querySelector('.games')?.after(more);
      this._renderPending=true;return;
    }
    this._renderPending=false;this.shadowRoot.innerHTML=markup;
    this._mountF1();
    this.shadowRoot.querySelector('.shell').scrollTop=scroll;
    if(this.shadowRoot.querySelector('.sport-filters'))this.shadowRoot.querySelector('.sport-filters').scrollLeft=filterScroll;
    this.shadowRoot.querySelector('.nav').scrollLeft=this._renderedDashboardKey===profile?.key?navScroll:0;this._renderedDashboardKey=profile?.key;
    if(buttonFocus){[...this.shadowRoot.querySelectorAll('[data-action]')].find(el=>el.dataset.action===buttonFocus.action&&el.dataset.value===buttonFocus.value)?.focus({preventScroll:true});}
    if(this.shadowRoot.querySelector('.modal'))this.shadowRoot.querySelector('.modal').scrollTop=modalScroll;
    if(focused){const input=this.shadowRoot.getElementById(focused);input?.focus({preventScroll:true});if(selection&&input)input.setSelectionRange(...selection);}
  }
  async _click(event){
    const button=event.target.closest('[data-action]');if(!button)return;
    const {action,value}=button.dataset;
    if(action==='menu'){this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));return;}
    if(action==='retry'){this._fetch();return;}
    if(action==='dossier-retry'){this._ensureDossier(this.activeDashboard,true);return;}
    if(this._busy)return;
    if(action==='dashboard-open'){this._dossierLeague='all';this._activeDashboardKey=value;this.view='home';this.search='';this.sport='all';this.league='all';this.allDates=true;this._detail=null;}
    if(action==='dashboard-back'){this._activeDashboardKey=null;this.view='dashboards';}
    if(action==='dashboard-preview'){this._propose(this._findProfile(value));return;}
    if(action==='dashboard-cancel'){this._proposal=null;this._actionError='';}
    if(action==='dashboard-approve'){await this._approve();return;}
    if(action==='dashboard-remove'){await this._dashboardRequest({action:'remove',key:value});this._render();return;}
    if(action==='sidebar-remove'){await this._dashboardRequest({action:'unpublish',key:value});this._render();return;}
    if(action==='view'){this.view=value;this.limit=24;this._detail=null;this.allDates=!!this.activeDashboard||['schedule','results','favorites'].includes(value);}
    if(action==='sport'){this.sport=value;this.league='all';this.limit=24;}
    if(action==='league'){this.league=value;this.sport='all';this.view='home';this.allDates=true;this.limit=24;}
    if(action==='spoiler'){this.hideScores=!this.hideScores;this.revealed.clear();this._savePreferences();}
    if(action==='favorite'||action==='league-favorite'){
      const key=action==='league-favorite'?'league:'+value:value;
      if(this.favorites.includes(key))this.favorites=this.favorites.filter(k=>k!==key);
      else if(this.favorites.length<200){
        this.favorites.push(key);const profile=this._findProfile(action==='league-favorite'?key:'team:'+key);
        this.favoriteNames[key]=profile?.name||button.dataset.name||key;this._savePreferences();
        if(profile&&!approvedProfile(this.dashboards,profile.key)){this._propose(profile);return;}
      }
      this._savePreferences();
    }
    if(action==='date-shift'){this.date=shiftDate(this.date,Number(value));this.allDates=false;this.limit=24;}
    if(action==='today'){this.date=dateKey(this.now,this.zone);this.allDates=false;this.limit=24;}
    if(action==='all-dates'){this.allDates=!this.allDates;this.limit=24;}
    if(action==='match-tab'){this._matchTab=value;}
    if(action==='match-retry'){this._ensureMatch(this._profileEvents(this.activeDashboard).find(e=>e.id===this._detail),true);return;}
    if(action==='details'){this._matchTab='home';this._detail=value;this._returnFocus=value;}
    if(action==='close'){this._detail=null;}
    if(action==='reveal'){this.revealed.add(value);}
    if(action==='more'){this.limit+=24;}
    this._render();
    if(['view','league','dashboard-open','dashboard-back'].includes(action))this.shadowRoot.querySelector('.shell').scrollTop=0;
    if(action==='details')this.shadowRoot.querySelector('[data-action="close"]')?.focus();
    if(action==='close')Array.from(this.shadowRoot.querySelectorAll('[data-action="details"]')).find(el=>el.dataset.value===this._returnFocus)?.focus();
  }
  _change(event){
    if(event.target.id==='search')return;
    if(event.target.id==='dossier-league'){this._dossierLeague=event.target.value;this.limit=24;this._render();return;}
    if(this._proposal&&['dashboard-name','dashboard-color','dashboard-secondary','dashboard-sidebar'].includes(event.target.id)){const key={'dashboard-name':'name','dashboard-color':'color','dashboard-secondary':'alternate_color','dashboard-sidebar':'sidebar'}[event.target.id];this._proposal[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;if(event.target.type!=='text')this._render();return;}
if(event.target.id==='league'){this.league=event.target.value;this.limit=24;}if(event.target.id==='date'){this.date=event.target.value||dateKey(this.now,this.zone);this.allDates=false;this.limit=24;}this._render();}
  _key(event){if(event.target.matches('input,textarea,select'))event.stopPropagation();if(!this._detail&&!this._proposal)return;if(event.key==='Escape'){this._detail=null;this._proposal=null;this._render();event.preventDefault();}if(event.key==='Tab'){const nodes=[...this.shadowRoot.querySelectorAll('.modal button,.modal a[href],.modal input')];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&this.shadowRoot.activeElement===first){last?.focus();event.preventDefault();}else if(!event.shiftKey&&this.shadowRoot.activeElement===last){first?.focus();event.preventDefault();}}}
}

Object.assign(SportsHubPanel.prototype,dossierMethods,f1DossierMethods,matchMethods);

if(!customElements.get('sports-hub-panel'))customElements.define('sports-hub-panel',SportsHubPanel);
