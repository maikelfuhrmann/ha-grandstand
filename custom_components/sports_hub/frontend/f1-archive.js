import {escapeHtml} from './model.js';

export const f1ArchiveMethods={
  _archiveSelection(f1){return this._f1ArchiveSelection||{season:String(f1.last_completed?.season||f1.result_season||f1.season||new Date(this.now).getFullYear()),round:String(f1.last_completed?.round||'')};},
  _archiveKey(profile,selection){return [profile.key,selection.season,selection.round||'last'].join(':');},
  async _ensureF1Archive(profile,selection){
    if(!this._hass)return;
    this._f1Archives||={};const key=this._archiveKey(profile,selection),cached=this._f1Archives[key];
    if(cached?.busy||cached&&Date.now()-cached.fetched<60000)return;
    const userId=this._hass.user?.id;
    this._f1Archives[key]={...cached,busy:true};
    try{
      const data=await this._hass.callWS({type:'sports_hub/context',key:profile.key,season:Number(selection.season),...(selection.round?{round:Number(selection.round)}:{})});
      if(userId!==this._hass.user?.id)return;
      this._f1Archives[key]={data,fetched:Date.now()};
    }catch{if(userId!==this._hass.user?.id)return;this._f1Archives[key]={...cached,error:true,fetched:Date.now()};}
    if(this.isConnected&&this.view==='results'&&this.activeDashboard?.key===profile.key)this._render();
  },
  _changeF1Archive(id,value){
    const selection=this._archiveSelection(this._dossierData(this.activeDashboard)?.f1||{});
    this._f1ArchiveSelection=id==='f1-result-season'?{season:value,round:''}:{...selection,round:value};
    this._render();
  },
  _f1Archive(profile,f1){
    const selected=this._archiveSelection(f1);this._ensureF1Archive(profile,selected);
    const cached=this._f1Archives?.[this._archiveKey(profile,selected)],archive=cached?.data;
    const seasons=Array.from({length:new Date(this.now).getFullYear()-1949},(_,i)=>String(new Date(this.now).getFullYear()-i));
    const chosen=selected.round||archive?.round||'';
    const filters=`<div class="f1-result-filters"><label>${escapeHtml(this.t.season)} / ${escapeHtml(this.t.year)}<select id="f1-result-season" aria-label="${escapeHtml(this.t.season+' / '+this.t.year)}">${seasons.map(year=>`<option value="${year}" ${year===selected.season?'selected':''}>${year}</option>`).join('')}</select></label><label>${escapeHtml(this.t.race)}<select id="f1-result-race" aria-label="${escapeHtml(this.t.race)}" ${archive?.calendar?.length?'':'disabled'}>${archive?.calendar?.length?archive.calendar.map(r=>`<option value="${escapeHtml(r.round)}" ${String(r.round)===chosen?'selected':''}>${escapeHtml(r.round)} · ${escapeHtml(r.name)}</option>`).join(''):`<option>${escapeHtml(cached?.busy?this.t.loading:this.t.noSourceData)}</option>`}</select></label></div>`;
    const table=(rows,columns)=>rows?.length?`<div class="table-scroll"><table class="standings-table f1-classification"><thead><tr>${columns.map(([,label])=>`<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key])=>`<td>${escapeHtml(row[key]??'–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<p class="meta dossier-empty">${escapeHtml(this.t.resultsPending)}</p>`;
    const race=archive?.race;
    let body=!archive?`<p role="status" class="notice">${escapeHtml(cached?.error?this.t.richError:this.t.loading)}</p>`:
      `${cached.error||archive.error?`<p role="status" class="notice">${escapeHtml(this.t.richError)}</p>`:''}<div class="f1-result-meeting"><h2>${escapeHtml(race?.name||this.t.noSourceData)}</h2>${race?`<p>${escapeHtml(this._format(race.date,{dateStyle:'long'}))} · ${escapeHtml(race.circuit)}</p>`:''}</div>${table(archive.results,[['rank','#'],['name',this.t.drivers],['team',this.t.team],['laps',this.t.laps],['time',this.t.time],['points',this.t.points]])}`;
    return `<section class="dossier-section f1-results-primary">${filters}${body}</section>${archive?this._dossierSection(this.t.qualifying,table(archive.qualifying,[['position','#'],['name',this.t.drivers],['team',this.t.team],['q1','Q1'],['q2','Q2'],['q3','Q3']]))+this._sourceSummary(archive):''}`;
  },
};

export const f1ArchiveStyles=`
.f1-results-heading h1{font-size:clamp(30px,4vw,48px);line-height:1.15;margin:0 0 24px;font-weight:850;letter-spacing:-.035em}
.f1-result-filters{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:28px}.f1-result-filters label{display:flex;flex-direction:column;gap:8px;color:var(--muted);font-size:13px;font-weight:650;min-width:150px}.f1-result-filters label:last-child{flex:1;max-width:560px}.f1-result-filters select{font:inherit;font-size:15px;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:10px 36px 10px 14px;background:#131c25;color:var(--ink);max-width:100%}.f1-result-meeting h2{font-size:24px;margin-bottom:6px}.f1-result-meeting p{color:var(--muted);margin-top:0}.f1-classification td{padding-top:16px;padding-bottom:16px}.f1-classification tbody tr:first-child{background:#ff453a12}.f1-classification td:first-child{font-weight:800}.f1-results-primary+.dossier-section{margin-top:24px}
`;
