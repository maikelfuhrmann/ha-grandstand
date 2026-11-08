import {escapeHtml,safeUrl,isFreshLive} from './model.js';
import {colorValue,contrastColor} from './dashboards.js';
import {soccerFormation} from './lineup-layout.js';

export function matchReference(event){
  const parts=String(event?.id||'').split(':');
  return ['soccer','basketball','football','hockey','baseball','australian-football'].includes(event?.sport)&&event?.format==='match'&&parts.length===4&&/^\d{1,20}$/.test(parts[2])?{league_id:event.league_id,event_id:parts[2]}:null;
}
export const matchMethods={
  async _ensureMatch(event,force=false){
    const ref=matchReference(event);if(!ref||!this._hass)return;
    this._matches||={};const old=this._matches[event.id];
    if(old?.busy||(!force&&old&&Date.now()-old.fetched<25000))return;
    const user=this._hass.user?.id;this._matches[event.id]={...old,busy:true};
    try{const data=await this._hass.callWS({type:'sports_hub/match',...ref});if(user!==this._hass.user?.id)return;this._matches[event.id]={data,busy:false,fetched:Date.now()};}
    catch{if(user!==this._hass.user?.id)return;this._matches[event.id]={...old,error:true,busy:false,fetched:Date.now()};}
    if(Object.keys(this._matches).length>20)delete this._matches[Object.keys(this._matches).find(key=>key!==event.id)];
    if(this.isConnected&&this._detail===event.id)this._render();
  },
  _matchCenter(base){
    this._ensureMatch(base);const cached=this._matches?.[base.id],data=cached?.data;
    const event=data?.event&&(data.updated_at||'')>=(base.updated_at||'')?{...base,...data.event,id:base.id,name:base.name}:base;
    const hidden=this._hidden(event),tab=this._matchTab||'home',home=event.participants.find(p=>p.home_away==='home')||event.participants[0],away=event.participants.find(p=>p.home_away==='away')||event.participants[1];
    const score=event.state!=='scheduled'&&!hidden;
    const team=p=>p?`<div class="match-team">${this._logo(p)}<strong>${escapeHtml(p.name)}</strong></div>`:'';
    const header=`<div class="match-scoreboard">${team(home)}<div class="match-score"><span class="status ${isFreshLive(event,this.now)&&!hidden?'live':''}">${escapeHtml(this._status(event))}</span><b>${score?escapeHtml(home?.score??'–')+' : '+escapeHtml(away?.score??'–'):hidden?'• : •':'vs'}</b><small>${escapeHtml(event.time_confirmed?this._format(event.date,{dateStyle:'medium',timeStyle:'short'}):this.t.timeTbd)}</small></div>${team(away)}</div>`;
    const loading=!data?`<p class="notice">${escapeHtml(cached?.error?this.t.richError:this.t.matchLoading)}${cached?.error?` <button class="text-action" data-action="match-retry">${escapeHtml(this.t.retry)}</button>`:''}</p>`:'';
    const stats=this._matchStats(data),ticker=this._matchTimeline(data,tab==='home'?6:200),lineups=this._matchLineups(data,event.sport);
    let content=hidden?`${this._spoilerNotice()}<button class="cta primary" data-action="reveal" data-value="${escapeHtml(event.id)}">${escapeHtml(this.t.reveal)}</button>`:tab==='ticker'?ticker:tab==='lineups'?lineups:tab==='matchStats'?stats:tab==='playerStats'?this._matchPlayers(data):`<div class="match-columns"><section>${this._dossierSection(this.t.ticker,ticker,'match-tab','ticker')}</section><section>${this._dossierSection(this.t.matchStats,this._matchStats(data,8),'match-tab','matchStats')}</section></div>`;
    if(tab==='home')content+=this._radar(data?.radar,'match');
    const url=safeUrl(data?.url||event.url);
    return `<div class="modal-backdrop"><section class="modal match-modal" role="dialog" aria-modal="true" aria-labelledby="event-title"><div class="modal-head"><div><div class="eyebrow">${escapeHtml(event.league)} · ${escapeHtml(this.t.matchCenter)}</div><h2 id="event-title">${escapeHtml(event.name)}</h2></div><button class="icon-button" data-action="close" aria-label="${escapeHtml(this.t.close)}">×</button></div>${header}<nav class="match-nav" aria-label="${escapeHtml(this.t.matchCenter)}">${['home','ticker','lineups','matchStats','playerStats'].map(key=>`<button class="${tab===key?'active':''}" data-action="match-tab" data-value="${key}" ${tab===key?'aria-current="page"':''}>${escapeHtml(this.t[key])}</button>`).join('')}</nav>${loading}${data?.stale||cached?.error&&data?`<p class="alert">${escapeHtml(this.t.stale)}</p>`:''}${content}<div class="match-facts"><span>${escapeHtml(data?.venue||event.venue||this.t.unknown)}${data?.city?' · '+escapeHtml(data.city):''}</span>${data?.attendance>0?`<span>${escapeHtml(this.t.attendance)} · ${new Intl.NumberFormat(this.lang).format(data.attendance)}</span>`:''}${data?.officials?.length?`<span>${escapeHtml(this.t.officials)} · ${escapeHtml(data.officials.join(', '))}</span>`:''}</div><div class="match-source"><div class="meta">${escapeHtml(this.t.updated)} · ${escapeHtml(this._format(data?.updated_at||event.updated_at,{dateStyle:'short',timeStyle:'short'}))}<br>${escapeHtml(this.t.autoMatch)}</div>${url?`<a class="text-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">ESPN ↗</a>`:''}</div></section></div>`;
  },
  _matchTimeline(data,limit=200){
    const events=data?.timeline||[];
    return `<p class="meta">${escapeHtml(this.t.tickerHint)}${data?.timeline_kind==='scoring'?' '+escapeHtml(this.t.scoringOnly)+'.':''}</p>${events.length?`<div class="match-timeline">${events.slice(0,limit).map(p=>{const team=data.teams?.find(t=>t.team.id===p.team_id)?.team;const type=p.kind.includes('red')?'red':p.kind.includes('yellow')?'yellow':p.scoring?'goal':'';return `<article class="timeline-event ${type}"><div class="event-minute"><strong>${escapeHtml(p.clock||'–')}</strong>${p.period?`<small>${escapeHtml(this.t.period||'P')}${escapeHtml(p.period)}</small>`:''}</div><span class="event-dot">${type==='goal'?'●':p.kind==='substitution'?'↔':type?'▮':'·'}</span><div><strong>${escapeHtml(this.t[p.kind]||p.label)}</strong>${p.participants?.length?`<p>${escapeHtml(p.participants.join(p.kind==='substitution'?' ↔ ':' · '))}</p>`:''}${team?`<small>${escapeHtml(team.name)}</small>`:''}</div>${p.home_score!=null&&p.away_score!=null?`<b class="ticker-score">${escapeHtml(p.home_score)} : ${escapeHtml(p.away_score)}</b>`:''}</article>`;}).join('')}</div>`:`<p class="dossier-empty meta">${escapeHtml(this.t.tickerPending)}</p>`}`;
  },
  _matchStats(data,limit=60){
    const teams=data?.teams||[];
    if(teams.length<2||!teams.some(t=>t.stats?.length))return `<p class="dossier-empty meta">${escapeHtml(this.t.statsPending)}</p>`;
    const keys=[...new Set(teams.flatMap(t=>t.stats.map(s=>s.key)))];
    const priority=['possessionPct','totalShots','shotsOnTarget','wonCorners','foulsCommitted','yellowCards','redCards','saves','totalPasses','passPct'];
    keys.sort((a,b)=>(priority.includes(a)?priority.indexOf(a):100)-(priority.includes(b)?priority.indexOf(b):100));
    return `${data.stats_scope==='season'?`<p class="notice">${escapeHtml(this.t.preMatchStats)}</p>`:''}<div class="stat-team-names"><strong>${escapeHtml(teams[0].team.short_name||teams[0].team.name)}</strong><strong>${escapeHtml(teams[1].team.short_name||teams[1].team.name)}</strong></div><div class="match-stats">${keys.slice(0,limit).map(key=>{const a=teams[0].stats.find(s=>s.key===key),b=teams[1].stats.find(s=>s.key===key),bar=a?.value!=null&&b?.value!=null&&a.value>=0&&b.value>=0&&a.value+b.value>0,share=bar?Math.max(0,Math.min(100,a.value/(a.value+b.value)*100)):50;return `<div class="match-stat"><div><b>${escapeHtml(a?.display??'–')}</b><span>${escapeHtml(this.t[key]||a?.label||b?.label||key)}</span><b>${escapeHtml(b?.display??'–')}</b></div>${bar?`<div class="stat-bar"><i style="width:${share}%"></i><i style="width:${100-share}%"></i></div>`:''}</div>`;}).join('')}</div>`;
  },
  _soccerPitch(lineup,rows){
    const color=colorValue(lineup.team.color,'#dce7ef'),ink=contrastColor(color);
    const player=p=>`<div class="pitch-player" title="${escapeHtml(p.name+' · '+p.position)}"><span class="pitch-shirt" ${['G','GK'].includes(p.position)?'style="--kit:#f5ce58;--kit-ink:#101822"':''}><svg viewBox="0 0 60 64" aria-hidden="true"><path d="M18 4 5 12 0 28 12 33 15 26 15 60 45 60 45 26 48 33 60 28 55 12 42 4 36 7 24 7Z"/><path class="shirt-neck" d="M24 7Q30 18 36 7"/></svg><b>${escapeHtml(p.number||'–')}</b></span><strong>${escapeHtml(p.name)}</strong>${p.out?`<span class="pitch-sub" aria-label="${escapeHtml(this.t.substitutedOut)}">↙</span>`:''}</div>`;
    return `<figure class="lineup-pitch" style="--kit:${color};--kit-ink:${ink}"><figcaption><span>${escapeHtml(this.t.starters)}</span><span>↑ ${escapeHtml(this.t.attackingDirection)}</span></figcaption><div class="pitch-surface"><svg class="pitch-lines" viewBox="0 0 680 900" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H660V880H20Z M20 450H660 M170 20V160H510V20 M250 20V75H430V20 M170 880V740H510V880 M250 880V825H430V880 M300 20V7H380V20 M300 880V893H380V880"/><circle cx="340" cy="450" r="85"/><circle cx="340" cy="450" r="3"/><path d="M275 160Q340 222 405 160 M275 740Q340 678 405 740"/></g></svg><div class="pitch-rows">${rows.map(row=>`<div class="pitch-row">${row.map(player).join('')}</div>`).join('')}</div></div><p class="meta">${escapeHtml(this.t.pitchSchematic)}</p></figure>`;
  },
  _matchLineups(data,sport=data?.event?.sport){
    const lineups=data?.lineups||[];
    const list=players=>`<div class="lineup-list">${players.map(p=>`<div class="lineup-player"><span class="jersey">${escapeHtml(p.number||'–')}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.position)}</small>${p.in?'<span class="sub-in">↗</span>':p.out?'<span class="sub-out">↙</span>':''}</div>`).join('')}</div>`;
    return `<div class="match-columns">${lineups.map(l=>{const rows=sport==='soccer'?soccerFormation(l):null;return `<section class="lineup-team"><div class="lineup-title">${this._logo(l.team)}<h3>${escapeHtml(l.team.name)}</h3>${l.formation?`<b class="stage-tag">${escapeHtml(l.formation)}</b>`:''}</div>${!l.players?.length?`<p class="dossier-empty meta">${escapeHtml(this.t.lineupPending)}</p>`:l.has_starters?`${rows?this._soccerPitch(l,rows)+`<details class="lineup-text"><summary>${escapeHtml(this.t.lineupList)}</summary>${list(l.players.filter(p=>p.starter))}</details>`:`${sport==='soccer'?`<p class="meta">${escapeHtml(this.t.pitchUnavailable)}</p>`:''}<h4>${escapeHtml(this.t.starters)}</h4>${list(l.players.filter(p=>p.starter))}`}<h4>${escapeHtml(this.t.bench)}</h4>${list(l.players.filter(p=>!p.starter))}`:`<h4>${escapeHtml(this.t.publishedRoster)}</h4>${list(l.players)}`}</section>`;}).join('')||`<p class="dossier-empty meta">${escapeHtml(this.t.lineupPending)}</p>`}</div>`;
  },
  _matchPlayers(data){
    const groups=data?.player_tables||[];
    return groups.map(g=>this._dossierSection(g.team.name+(g.name?' · '+g.name:''),`<div class="table-scroll"><table class="standings-table player-stats-table"><thead><tr><th>${escapeHtml(this.t.squad)}</th>${g.labels.map((v,i)=>`<th>${escapeHtml(this.t[g.keys[i]]||v)}</th>`).join('')}</tr></thead><tbody>${g.players.map(p=>`<tr><td>${escapeHtml(p.name)}${p.starter?' <span aria-label="'+escapeHtml(this.t.starters)+'">★</span>':''}</td>${g.labels.map((_,i)=>`<td>${escapeHtml(p.values[i]??'–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)).join('')||`<p class="dossier-empty meta">${escapeHtml(this.t.statsPending)}</p>`;
  },
};
