export function mergeProfileEvents(base,extra,profile){
  const result=new Map();
  for(const event of [...(extra||[]),...(base||[])]){
    if(profile?.kind==='team'&&!event.participants.some(p=>p.key===profile.target))continue;
    if(profile?.kind==='league'&&event.league_id!==profile.target)continue;
    const old=result.get(event.id);
    if(!old||(event.updated_at||'')>=(old.updated_at||''))result.set(event.id,event);
  }
  return [...result.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function clubForm(events,target){
  return events.filter(e=>e.state==='finished'&&e.format==='match'&&!e.stale).sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
    const own=e.participants.find(p=>p.key===target),other=e.participants.find(p=>p.key!==target);
    if(!own||!other||own.score==null||other.score==null)return null;
    const a=Number(own.score),b=Number(other.score);if(!Number.isFinite(a)||!Number.isFinite(b))return null;
    return {event:e,result:own.winner===true?'W':other.winner===true?'L':a>b?'W':a<b?'L':'D'};
  }).filter(Boolean).slice(0,5).reverse();
}
export function dossierTabs(profile){return profile?.target==='racing:f1'?['home','live','weatherRadar','qualifying','grid','championship','schedule','results','raceControl','strategy','news']:['home','live','weatherRadar','schedule','results','tables','competitionsTab',...(profile?.kind==='team'?['squad']:[]),'news'];}
