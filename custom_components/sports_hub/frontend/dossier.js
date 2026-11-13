import {escapeHtml, safeUrl, isFreshLive, filterEvents} from './model.js';
import {clubForm, mergeProfileEvents, dossierTabs} from './dossier-model.js';
import {dashboardEvents} from './dashboards.js';

export const dossierMethods={
  _profileEvents(profile){return profile?mergeProfileEvents(dashboardEvents(this._data?.events||[],profile),this._dossiers?.[profile.key+':'+this.lang]?.data?.events,profile):['myday','calendar'].includes(this.view)?[...new Map([...(this._personalData?.events||[]),...(this._data?.events||[])].map(e=>[e.id,e])).values()]:this._data?.events||[];},
  _dossierData(profile){return this._dossiers?.[profile.key+':'+this.lang]?.data;},
  async _ensureDossier(profile,force=false){
    if(!profile||!this._hass)return;
    const key=profile.key+':'+this.lang;this._dossiers||={};const cached=this._dossiers[key];
    if(cached?.busy){if(force)cached.refreshPending=true;return;}
    if(!force&&cached&&Date.now()-cached.fetched<30000)return;
    const userId=this._hass.user?.id;this._dossiers[key]={...cached,busy:true,refreshPending:false};
    try{const data=await this._hass.callWS({type:'sports_hub/context',key:profile.key,language:this.lang});if(userId!==this._hass.user?.id)return;this._dossiers[key]={data,fetched:Date.now(),busy:false,refreshPending:this._dossiers[key]?.refreshPending};}
    catch{if(userId!==this._hass.user?.id)return;this._dossiers[key]={...cached,error:true,fetched:Date.now(),busy:false,refreshPending:this._dossiers[key]?.refreshPending};}
    const again=this._dossiers[key]?.refreshPending;
    if(this.isConnected&&this.activeDashboard?.key+':'+this.lang===key)this._render();
    if(again)this._ensureDossier(profile,true);
  },
  _dossierSection(title,body,action='',value=''){
    return `<section class="dossier-section"><div class="dossier-heading"><h2>${escapeHtml(title)}</h2>${action?`<button class="text-action" data-action="${action}" data-value="${escapeHtml(value)}">${escapeHtml(this.t.viewAll)} ↗</button>`:''}</div>${body}</section>`;
  },
  _dossierEmpty(){return `<p class="meta dossier-empty">${escapeHtml(this.t.noSourceData)}</p>`;},
  _spoilerNotice(){return `<p class="notice">${escapeHtml(this.t.newsSpoilers)}</p>`;},
  _dossier(profile,events){
    this._ensureDossier(profile);
    const cache=this._dossiers?.[profile.key+':'+this.lang],data=cache?.data;
    const state=!data?`<div class="dossier-loading" role="status">${escapeHtml(cache?.error?this.t.richError:this.t.richLoading)}${cache?.error?` <button class="cta" data-action="dossier-retry">${escapeHtml(this.t.retry)}</button>`:''}</div>`:'';
    if(profile.target==='racing:f1')return state+this._f1Dossier(profile,data)+(this.view==='results'?'':this._sourceSummary(data));
    const team=data?.team||{};
    const upcoming=events.filter(e=>e.state==='scheduled'&&Date.parse(e.date)>=this.now).sort((a,b)=>a.date.localeCompare(b.date));
    const recent=events.filter(e=>e.state==='finished').sort((a,b)=>b.date.localeCompare(a.date));
    const live=events.filter(e=>isFreshLive(e,this.now));
    let body='';
    if(this.view==='home'){
      const own=data?.tables?.flatMap(table=>table.groups.flatMap(g=>g.entries)).find(row=>row.team.id===team.id);
      const stat=(name)=>own?.stats?.[name]?.display??team.stats?.[name]?.display??'–';
      const form=clubForm(events,profile.target);
      const metrics=this.hideScores?'':`<div class="season-metrics">${[[this.t.rank,own?.rank??stat('rank')],[this.t.points,stat('points')],[this.t.played,stat('gamesPlayed')],[this.t.wins,stat('wins')],[this.t.draws,stat('ties')],[this.t.losses,stat('losses')]].filter(([,v])=>v!=='–').map(([label,value])=>`<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div>`;
      body=`<div class="dossier-hero"><div class="dossier-identity">${this._profileLogo(profile)}<div><div class="eyebrow">${escapeHtml(this.t.seasonOverview)} · ${escapeHtml(data?.competitions?.[0]?.name||this.t.teamDashboard)}</div><h1>${escapeHtml(profile.name)}</h1><p>${escapeHtml(team.venue||this.t.clubIntro)}</p></div></div>${metrics}<div class="dossier-hero-bottom">${form.length&&!this.hideScores?`<div class="form-strip"><span>${escapeHtml(this.t.form)}</span>${form.map(f=>`<button class="form-dot ${f.result}" data-action="details" data-value="${escapeHtml(f.event.id)}" aria-label="${escapeHtml(f.event.name+' · '+(f.result==='W'?this.t.wins:f.result==='D'?this.t.draws:this.t.losses))}">${f.result==='W'?'+':f.result==='D'?'=':'−'}</button>`).join('')}</div>`:''}<span class="meta">${upcoming.length} ${escapeHtml(this.t.scheduledCount)} · ${recent.length} ${escapeHtml(this.t.results)}</span></div></div>`;
      body+=`<div class="dossier-grid"><div class="dossier-wide">${this._dossierSection(this.t.nextMatches,upcoming.length?`<div class="fixture-stack">${upcoming.slice(0,3).map(e=>this._fixture(e,profile)).join('')}</div>`:state||this._dossierEmpty(),'view','schedule')}</div><div>${this._dossierSection(this.t.competitionsTab,this._competitionCards(data,true),'view','competitionsTab')}</div></div>`;
      if(live.length)body+=this._dossierSection(this.t.live,`<div class="games">${live.map(e=>this._game(e)).join('')}</div>`);
      body+=`<div class="dossier-grid"><div class="dossier-wide">${this._dossierSection(this.t.tables,this._tables(data,profile,true),'view','tables')}</div><div>${this._dossierSection(this.t.recentMatches,recent.length?recent.slice(0,3).map(e=>this._fixture(e,profile)).join(''):this._dossierEmpty(),'view','results')}</div></div>`;
      if(profile.kind==='team'&&!this.hideScores&&team.stats?.homeGamesPlayed){const statRows=[['home',this.t.homeMatches],['away',this.t.awayMatches]];body+=this._dossierSection(this.t.seasonStats,`<div class="season-splits">${statRows.map(([key,label])=>`<div><h3>${escapeHtml(label)}</h3><div class="season-metrics">${[['GamesPlayed',this.t.played],['Wins',this.t.wins],['Ties',this.t.draws],['Losses',this.t.losses],['PointsFor',this.t.for],['PointsAgainst',this.t.against]].filter(([suffix])=>team.stats[key+suffix]?.value!=null).map(([suffix,title])=>`<div><strong>${escapeHtml(team.stats[key+suffix].value)}</strong><span>${escapeHtml(title)}</span></div>`).join('')}</div></div>`).join('')}</div>`);}
      body+=this._dossierSection(this.t.news,this._news(data,4),'view','news');
      if(profile.kind==='team')body+=`<div class="dossier-grid"><div class="dossier-wide">${this._dossierSection(this.t.squad,this._squad(data,8),'view','squad')}</div><div>${this._dossierSection(this.t.stadium,team.venue?`<div class="venue-card"><div class="venue-symbol">⌂</div><h3>${escapeHtml(team.venue)}</h3><p>${escapeHtml(team.city||'')}</p>${team.capacity?`<p>${escapeHtml(this.t.capacity)} · ${escapeHtml(new Intl.NumberFormat(this.lang).format(team.capacity))}</p>`:''}${safeUrl(team.url)?`<a class="text-action" href="${escapeHtml(team.url)}" target="_blank" rel="noopener noreferrer">ESPN ↗</a>`:''}</div>`:this._dossierEmpty())}</div></div>`;
    }else if(this.view==='weatherRadar')body=this._radar(data?.radar||{event_name:profile.name},'profile');
    else if(this.view==='tables')body=this._dossierSection(this.t.tables,this._tables(data,profile));
    else if(this.view==='competitionsTab')body=this._dossierSection(this.t.competitionsTab,this._competitionCards(data))+this._dossierSection(this.t.cup,events.filter(e=>e.tournament).map(e=>this._fixture(e,profile)).join('')||this._dossierEmpty());
    else if(this.view==='squad')body=this._dossierSection(this.t.squad,this._squad(data));
    else if(this.view==='news')body=this._dossierSection(this.t.news,this._news(data));
    else{
      const filtered=filterEvents(events,{view:this.view,league:this._dossierLeague||'all',now:this.now,timeZone:this.zone});
      const leagues=[...new Map(events.map(e=>[e.league_id,e.league])).entries()];
      body=`<div class="dossier-heading"><div><h1>${escapeHtml(profile.name)}</h1><p class="meta">${escapeHtml(this.t.seasonHint)}</p></div><select id="dossier-league" aria-label="${escapeHtml(this.t.leagues)}"><option value="all">${escapeHtml(this.t.allLeagues)}</option>${leagues.map(([id,name])=>`<option value="${escapeHtml(id)}" ${id===this._dossierLeague?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select></div>${filtered.length?filtered.slice(0,this.limit||24).map(e=>this._fixture(e,profile)).join(''):this._dossierEmpty()}${filtered.length>this.limit?`<button class="cta" data-action="more">${escapeHtml(this.t.more)}</button>`:''}`;
    }
    if(['home','live','schedule'].includes(this.view))body+=this._radar(data?.radar,'profile');
    return `${state}${cache?.error&&data?`<p class="alert">${escapeHtml(this.t.richError)}</p>`:''}<div class="dossier-controls"><span class="meta">${escapeHtml(this.t.seasonSchedule)}</span><button class="spoiler" data-action="spoiler" aria-pressed="${this.hideScores}">${escapeHtml(this.hideScores?this.t.show:this.t.hide)}</button></div>${body}${this._sourceSummary(data)}`;
  },
  _fixture(event,profile){
    const home=event.participants.find(p=>p.home_away==='home')||event.participants[0],away=event.participants.find(p=>p.home_away==='away')||event.participants[1];
    if(!home||!away||event.format!=='match')return this._game(event);
    const score=event.state!=='scheduled'&&!this._hidden(event),live=isFreshLive(event,this.now);
    return `<article class="fixture-row ${live?'is-live':''}"><div class="fixture-date"><strong>${escapeHtml(event.time_confirmed?this._format(event.date,{day:'2-digit',month:'short'}):this.t.timeTbd)}</strong><small>${escapeHtml(event.time_confirmed?this._format(event.date,{hour:'2-digit',minute:'2-digit'}):'')}</small></div><div class="fixture-main"><small class="fixture-competition">${this._leagueBadge(event)}${escapeHtml(event.league)}${event.round?' · '+escapeHtml(event.round):''}</small><div class="fixture-teams">${this._logo(home)}<strong>${escapeHtml(home.short_name||home.name)}</strong><span class="fixture-score">${score?escapeHtml(home.score??'–')+' : '+escapeHtml(away.score??'–'):'vs'}</span><strong>${escapeHtml(away.short_name||away.name)}</strong>${this._logo(away)}</div><small>${escapeHtml(event.venue||'')}</small></div><div class="fixture-end"><span class="status ${live?'live':''}">${escapeHtml(this._status(event))}</span><button class="text-action" data-action="details" data-value="${escapeHtml(event.id)}">${escapeHtml(this.t.details)} ↗</button></div></article>`;
  },
  _competitionCards(data,compact=false){
    if(!data?.competitions?.length)return this._dossierEmpty();
    return `<div class="competition-grid ${compact?'compact':''}">${data.competitions.map(c=>`<article class="competition-card"><div class="eyebrow">${escapeHtml(c.tournament?this.t.cup:this.t.league)}</div><h3>${escapeHtml(c.name)}</h3>${!this.hideScores&&c.rank!=null?`<p><strong>#${escapeHtml(c.rank)}</strong> · ${escapeHtml(c.points??'–')} ${escapeHtml(this.t.points)}</p>`:''}<p class="meta">${c.played} ${escapeHtml(this.t.played)} · ${c.upcoming} ${escapeHtml(this.t.scheduledCount)}</p>${c.round?`<span class="stage-tag">${escapeHtml(c.round)}</span>`:''}</article>`).join('')}</div>`;
  },
  _tables(data,profile,compact=false){
    if(this.hideScores)return this._spoilerNotice();
    if(!data?.tables?.length)return this._dossierEmpty();
    const definitions=[['gamesPlayed','played'],['wins','wins'],['ties','draws'],['losses','losses'],['pointsFor','for'],['pointsAgainst','against'],['pointDifferential','difference'],['winPercent','winPercent'],['gamesBehind','behind'],['points','points']];
    return (compact?data.tables.slice(0,1):data.tables).map(table=>table.groups.map(group=>{
      const columns=definitions.filter(([key])=>(!compact||['gamesPlayed','pointDifferential','winPercent','points','wins','losses'].includes(key))&&group.entries.some(row=>row.stats[key]?.value!=null));
      let entries=group.entries;
      if(compact&&entries.length>7){const own=entries.findIndex(r=>r.team.id===data.team?.id);entries=own>5?[...entries.slice(0,3),...entries.slice(Math.max(3,own-1),own+2)]:entries.slice(0,7);}
      return `<div class="table-block"><div class="table-caption"><strong>${escapeHtml(table.name)}</strong><span>${escapeHtml(group.name)}${table.stale?' · '+escapeHtml(this.t.stale):''}</span></div><div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>${escapeHtml(this.t.team)}</th>${columns.map(([,key])=>`<th>${escapeHtml(this.t[key])}</th>`).join('')}</tr></thead><tbody>${entries.map(row=>`<tr class="${row.team.id===data.team?.id?'selected-team':''}"><td>${escapeHtml(row.rank)}</td><td><div class="standings-team">${this._logo(row.team)}<span>${escapeHtml(row.team.name)}</span></div></td>${columns.map(([key])=>`<td>${escapeHtml(row.stats[key]?.display??'–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${safeUrl(group.url)?`<a class="source-link" href="${escapeHtml(group.url)}" target="_blank" rel="noopener noreferrer">ESPN ↗</a>`:''}</div>`;
    }).join('')).join('');
  },
  _news(data,limit=12){
    if(this.hideScores)return this._spoilerNotice();
    const articles=data?.news?.articles||[];
    return `<p class="meta">${escapeHtml(this.t.newsHint)}</p>${data?.news?.stale?`<p class="notice">${escapeHtml(this.t.stale)}</p>`:''}${articles.length?`<div class="news-grid">${articles.slice(0,limit).map((article,i)=>`<a class="news-card" href="${escapeHtml(safeUrl(article.url))}" target="_blank" rel="noopener noreferrer"><div class="news-meta"><span>${escapeHtml(article.source)}</span><time>${escapeHtml(this._format(article.published,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</time></div><h3>${escapeHtml(article.title)}</h3><span class="news-read">${escapeHtml(this.t.readArticle)} ↗</span></a>`).join('')}</div>`:this._dossierEmpty()}`;
  },
  _squad(data,limit=100){
    const roster=data?.roster||[];
    return roster.length?`<div class="squad-grid">${roster.slice(0,limit).map(p=>`<article class="player-card"><span class="jersey">${escapeHtml(p.number||'–')}</span>${p.photo?`<img src="${escapeHtml(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<div><strong>${safeUrl(p.url)?`<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.name)} ↗</a>`:escapeHtml(p.name)}</strong><small>${escapeHtml(p.position)}${p.age?' · '+p.age+' '+escapeHtml(this.t.years):''}</small><small>${escapeHtml(p.country)}</small></div></article>`).join('')}</div>`:this._dossierEmpty();
  },
  _sourceSummary(data){
    if(!data)return '';
    return `<details class="source-details"><summary>${escapeHtml(this.t.sources)}</summary><div class="source-grid">${[...(data.sources||[]),...(data.news?[{name:'News · Google News / ESPN',updated_at:data.news.updated_at,stale:data.news.stale}]:[])].map(s=>`<div><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.stale?this.t.stale:this.t.updated)} · ${escapeHtml(this._format(s.updated_at,{dateStyle:'short',timeStyle:'short'}))}</span></div>`).join('')}</div></details>`;
  },
};
