import {escapeHtml} from './model.js';

export function practiceClock(value){
  if(!Number.isFinite(value)||value<=0)return '–';
  const ms=Math.round(value*1000);return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
const practiceTyres={SOFT:['S','#ff5d63'],MEDIUM:['M','#f7d849'],HARD:['H','#edf3f8'],INTERMEDIATE:['I','#5bd78a'],WET:['W','#69b9ff'],UNKNOWN:['?','#9aa9bb']};

export const f1PracticeMethods={
  _practiceSelection(f1,compact=false){
    return !compact&&this._f1PracticeSelection||{season:String(f1.focus?.season||f1.season||new Date(this.now).getFullYear()),round:String(f1.focus?.round||''),practice:0};
  },
  _practiceKey(profile,selected){return [profile.key,selected.season,selected.round||'current',selected.practice||'latest'].join(':');},
  async _ensurePractice(profile,selected,force=false){
    if(!this._hass)return;this._f1Practices||={};
    const key=this._practiceKey(profile,selected),cached=this._f1Practices[key];
    if(cached?.busy||!force&&cached&&Date.now()-cached.fetched<60000)return;
    const userId=this._hass.user?.id;this._f1Practices[key]={...cached,busy:true};
    try{
      const data=await this._hass.callWS({type:'sports_hub/context',key:profile.key,season:Number(selected.season),practice:Number(selected.practice||0),...(selected.round?{round:Number(selected.round)}:{})});
      if(userId!==this._hass.user?.id)return;
      this._f1Practices[key]={data,fetched:Date.now()};
    }catch{if(userId!==this._hass.user?.id)return;this._f1Practices[key]={...cached,error:true,fetched:Date.now()};}
    if(this.isConnected&&this.activeDashboard?.key===profile.key&&['home','practice','live'].includes(this.view))this._render();
  },
  _changePractice(field,value){
    const previous=this._practiceSelection(this._dossierData(this.activeDashboard)?.f1||{});
    if(field==='current')this._f1PracticeSelection=null;
    else this._f1PracticeSelection=field==='season'?{season:value,round:'',practice:0}:field==='round'?{...previous,round:value,practice:0}:{...previous,practice:Number(value)};
    this._render();
  },
  _practiceTyre(compound,count){
    const [letter,color]=practiceTyres[compound]||practiceTyres.UNKNOWN;
    const label=this.t.practiceCompounds[compound]||this.t.practiceCompounds.UNKNOWN;
    return `<span class="practice-tyre" style="--tyre:${color}" title="${escapeHtml(label)}"><b aria-label="${escapeHtml(label)}">${letter}</b>${count==null?'':`<span>${escapeHtml(count)}</span>`}</span>`;
  },
  _practiceUsage(row){
    const chips=Object.entries(row.compounds||{}).map(([compound,count])=>this._practiceTyre(compound,count)).join('');
    return chips+(row.unassigned_laps>0?this._practiceTyre('UNKNOWN',row.unassigned_laps):'')||'–';
  },
  _practiceTable(rows,compact=false){
    if(!rows.length)return this._dossierEmpty();
    return `<div class="table-scroll"><table class="standings-table practice-table"><thead><tr>${['#',this.t.drivers,this.t.bestLap,...(compact?[]:[this.t.practiceGap]),rows.some(r=>r.recorded_only)?this.t.practiceRecordedLaps:this.t.totalLaps,this.t.compoundLaps].map(label=>`<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td class="practice-rank">${escapeHtml(row.dsq?'DSQ':row.position??'–')}</td><td><span class="practice-driver" style="--team:${escapeHtml(row.color)}"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.team)}</small></span></td><td class="practice-time">${escapeHtml(practiceClock(row.best))}${row.best_compound?this._practiceTyre(row.best_compound):''}</td>${compact?'':`<td>${escapeHtml(row.gap===0?'–':Number.isFinite(row.gap)?'+'+row.gap.toFixed(3):row.gap_label||'–')}</td>`}<td class="practice-laps">${escapeHtml(row.laps??'–')}</td><td><div class="practice-usage">${this._practiceUsage(row)}</div></td></tr>`).join('')}</tbody></table></div>`;
  },
  _practiceDetails(rows){
    return `<div class="practice-driver-details">${rows.map(row=>`<details id="practice-driver-${row.number}"><summary><span class="practice-driver" style="--team:${escapeHtml(row.color)}"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.team)}</small></span><span>${escapeHtml(row.laps??'–')} ${escapeHtml(row.laps===1?this.t.practiceLap:this.t.laps)} · ${row.stints.length} ${escapeHtml(row.stints.length===1?this.t.practiceStint:this.t.practiceStints)}</span></summary>${row.stints.length?`<div class="practice-stint-strip">${row.stints.map(stint=>`<div style="--tyre:${(practiceTyres[stint.compound]||practiceTyres.UNKNOWN)[1]}"><span>${this._practiceTyre(stint.compound)} ${escapeHtml(this.t.practiceStint)} ${stint.number}</span><strong>${stint.laps} ${escapeHtml(stint.laps===1?this.t.practiceLap:this.t.laps)}</strong><small>${escapeHtml(this.t.practiceLapRange)} ${stint.start}–${stint.end}</small><small>${escapeHtml(this.t.practiceTyreAge)}: ${escapeHtml(stint.tyre_age??'–')}</small><small>${escapeHtml(this.t.practiceRecordedBest)}: ${escapeHtml(practiceClock(stint.best))}</small></div>`).join('')}</div>`:`<p class="meta">${escapeHtml(this.t.practiceNoTyres)}</p>`}${row.unassigned_laps>0?`<p class="meta">${row.unassigned_laps} ${escapeHtml(this.t.practiceUnassigned)}</p>`:''}</details>`).join('')}</div>`;
  },
  _f1Practice(profile,f1,compact=false){
    const selection=this._practiceSelection(f1,compact);this._ensurePractice(profile,selection);
    const cached=this._f1Practices?.[this._practiceKey(profile,selection)],data=cached?.data,session=data?.session,rows=data?.rows||[];
    const recorded=rows.some(r=>r.recorded_only);
    const title=this.t.practice+(session?' · '+session.name:'');
    if(compact){
      if(!rows.length)return '';
      const body=!data?`<p class="meta" role="status">${escapeHtml(cached?.error?this.t.richError:this.t.loading)}</p>`:`<p class="meta">${escapeHtml(data.race?.name||'')}${session?' · '+escapeHtml(this._format(session.date,{weekday:'short',hour:'2-digit',minute:'2-digit'})):''}</p>${recorded?`<p class="meta">${escapeHtml(this.t.practiceNoClassification)}</p>`:''}${rows.length?this._practiceTable(rows.slice(0,3),true):`<p class="meta">${escapeHtml(session?.state==='scheduled'?this.t.practiceScheduled:this.t.practicePending)}</p>`}`;
      return this._dossierSection(title,body,'view','practice');
    }
    const year=new Date(this.now).getFullYear(),seasons=Array.from({length:Math.max(1,year-2022)},(_,i)=>String(year-i));
    const seasonLabel=this.t.season+' / '+this.t.year;
    const filters=`<div class="f1-result-filters"><label>${escapeHtml(seasonLabel)}<select id="f1-practice-season" aria-label="${escapeHtml(seasonLabel)}">${seasons.map(s=>`<option value="${s}" ${s===selection.season?'selected':''}>${s}</option>`).join('')}</select></label><label>${escapeHtml(this.t.race)}<select id="f1-practice-round" aria-label="${escapeHtml(this.t.race)}" ${data?.calendar?.length?'':'disabled'}>${data?.calendar?.length?data.calendar.map(r=>`<option value="${escapeHtml(r.round)}" ${String(r.round)===String(selection.round||data.round)?'selected':''}>${escapeHtml(r.round)} · ${escapeHtml(r.name)}</option>`).join(''):`<option>${escapeHtml(this.t.loading)}</option>`}</select></label><button class="chip" data-action="practice-current">${escapeHtml(this.t.practiceCurrent)}</button></div>`;
    if(!data)return `<section class="dossier-section">${filters}<p role="status">${escapeHtml(cached?.error?this.t.richError:this.t.loading)}</p></section>`;
    const tabs=`<div class="practice-tabs" role="group" aria-label="${escapeHtml(this.t.practice)}">${data.sessions.filter(s=>s.state!=='scheduled'||s.number===data.selected).map(s=>`<button class="chip ${s.number===data.selected?'active':''}" data-action="practice-session" data-value="${s.number}" aria-pressed="${s.number===data.selected}"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(this._format(s.date,{weekday:'short',hour:'2-digit',minute:'2-digit'}))}</span></button>`).join('')}</div>`;
    const complete=rows.length&&rows.every(r=>Number.isFinite(r.laps)),total=complete?rows.reduce((n,r)=>n+r.laps,0):null,most=[...rows].filter(r=>Number.isFinite(r.laps)).sort((a,b)=>b.laps-a.laps)[0],fastest=rows.find(r=>r.position===1&&!r.dsq);
    const metrics=rows.length?`<div class="practice-metrics">${[[this.t.bestLap,fastest?practiceClock(fastest.best):'–',fastest?.name||''],[recorded?this.t.practiceRecordedLaps:this.t.totalLaps,total??'–',recorded?this.t.practiceObserved:this.t.practiceAllDrivers],[this.t.practiceMostLaps,most?.laps??'–',most?.name||''],[this.t.drivers,rows.length,recorded?this.t.practiceObserved:this.t.practicePublished]].map(([label,value,detail])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join('')}</div>`:'';
    const notice=cached.error||data.error?`<p class="notice" role="status">${escapeHtml(this.t.richError)}</p>`:'';
    const pending=!rows.length?`<p class="notice">${escapeHtml(session?.state==='cancelled'?this.t.practiceCancelled:session?.state==='scheduled'?this.t.practiceScheduled:this.t.practicePending)}</p>`:'';
    return `<section class="dossier-section">${filters}<div class="f1-result-meeting"><div class="eyebrow">${escapeHtml(title)}</div><h2>${escapeHtml(data.race?.name||this.t.noSourceData)}</h2><p>${escapeHtml(data.race?.circuit||'')}${session?' · '+escapeHtml(this._format(session.date,{dateStyle:'medium',timeStyle:'short'})):''}</p></div>${tabs}${notice}${recorded?`<p class="notice">${escapeHtml(this.t.practiceNoClassification)}</p>`:''}${metrics}${pending}${rows.length?this._practiceTable(rows):''}<p class="meta">${escapeHtml(this.t.practiceFreeDelay)}</p></section>${rows.length?this._dossierSection(this.t.practiceDetails,`<p class="meta">${escapeHtml(this.t.practiceUsageNote)}</p>`+this._practiceDetails(rows)):''}${this._sourceSummary(data)}`;
  },
};

export const f1PracticeStyles=`
.f1-result-filters>.chip{align-self:flex-end;min-height:48px}.practice-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.practice-tabs button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:130px}.practice-tabs button span{font-size:12px;color:var(--muted)}.practice-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.practice-metrics>div{padding:18px;border:1px solid var(--line);border-radius:14px;background:#0b101750;display:flex;flex-direction:column;gap:8px}.practice-metrics span,.practice-metrics small{color:var(--muted);font-size:12px}.practice-metrics strong{font-size:28px;font-variant-numeric:tabular-nums;letter-spacing:-.04em}.practice-table td{padding:15px 12px}.practice-driver{display:inline-flex;flex-direction:column;border-left:3px solid var(--team);padding-left:10px;gap:4px}.practice-driver small{color:var(--muted);font-size:11px}.practice-rank,.practice-laps{font-weight:800;font-size:18px}.practice-time{font-variant-numeric:tabular-nums;white-space:nowrap}.practice-time .practice-tyre{margin-left:8px}.practice-usage{display:flex;gap:6px;flex-wrap:wrap;min-width:135px}.practice-tyre{display:inline-flex;align-items:center;gap:5px;color:var(--ink);white-space:nowrap}.practice-tyre b{display:inline-grid;place-items:center;border:2px solid var(--tyre);color:var(--tyre);border-radius:50%;width:23px;height:23px;font-size:11px;line-height:1}.practice-tyre span{font-variant-numeric:tabular-nums;font-weight:650;margin-right:5px}.practice-driver-details{display:grid;gap:10px}.practice-driver-details details{border:1px solid var(--line);border-radius:14px;background:#0b101730;padding:16px}.practice-driver-details summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}.practice-driver-details summary:after{content:'+';color:var(--muted)}.practice-driver-details details[open] summary:after{content:'−'}.practice-driver-details summary>span:nth-child(2){margin-left:auto;color:var(--muted);font-size:12px}.practice-stint-strip{display:flex;gap:12px;overflow-x:auto;padding:18px 0 6px}.practice-stint-strip>div{border-top:3px solid var(--tyre);border-radius:10px;background:#17212c;min-width:155px;padding:14px;display:flex;flex-direction:column;gap:9px}.practice-stint-strip>div>strong{font-size:22px}.practice-stint-strip small{color:var(--muted);font-size:12px}.practice-stint-strip>div>span{display:flex;align-items:center;gap:8px;font-size:12px}.practice-table tbody tr:first-child{background:#ff453a0a}@media(max-width:650px){.practice-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.practice-metrics strong{font-size:23px}.practice-table td{padding:12px 8px}.practice-driver-details summary{flex-wrap:wrap}.practice-driver-details summary>span:nth-child(2){margin-left:0}.practice-tabs button{min-width:100px}.practice-table{min-width:690px}}
`;
