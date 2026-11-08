// A published starting formation is a schematic, never live player tracking.
const roleDepth={G:0,GK:0,LB:1,RB:1,CD:1,CB:1,SW:1,LWB:2,RWB:2,WB:2,DM:2,CDM:2,LM:3,RM:3,CM:3,M:3,AM:4,CAM:4,LW:4,RW:4,LF:5,RF:5,CF:5,SS:5,F:5,ST:5};
function playerRole(player){
  const role=String(player.position||'').toUpperCase(),[base,side]=role.split('-');
  return {depth:roleDepth[base],side:side==='L'?-1:side==='R'?1:/^L/.test(base)?-2:/^R/.test(base)?2:0};
}
export function soccerFormation(lineup){
  const formation=String(lineup?.formation||'').trim();
  if(!/^\d(?:[-–]\d){1,4}$/.test(formation))return null;
  const counts=formation.split(/[-–]/).map(Number);
  if(counts.some(n=>n<1||n>5)||counts.reduce((a,b)=>a+b,0)!==10)return null;
  const starters=(lineup.players||[]).filter(p=>p.starter),keepers=starters.filter(p=>playerRole(p).depth===0);
  if(starters.length!==11||keepers.length!==1||new Set(starters.map(p=>p.id||p.name)).size!==11)return null;
  const outfield=starters.filter(p=>playerRole(p).depth!==0);
  if(outfield.some(p=>playerRole(p).depth==null))return null;
  outfield.sort((a,b)=>playerRole(a).depth-playerRole(b).depth);
  const rows=[keepers];let offset=0;
  for(const count of counts){rows.push(outfield.slice(offset,offset+count).sort((a,b)=>playerRole(a).side-playerRole(b).side));offset+=count;}
  return rows.reverse(); // Attacking direction is up; goalkeeper at the bottom.
}

export function startingGridModel(resource){
  const packet=resource?.data,readable=['ready','stale'].includes(packet?.status),attrs=readable?packet.payload?.attributes||{}:{};
  const seen=new Set(),rows=[];
  for(const item of (Array.isArray(attrs.grid)?attrs.grid:[]).slice(0,40)){
    const id=String(item?.racing_number||item?.tla||item?.driver_name||'');if(!id||seen.has(id))continue;seen.add(id);
    const raw=item.grid_position,value=raw==null||String(raw).trim()===''?null:Number(raw);
    const position=Number.isInteger(value)&&value>=0&&value<=40?value:null;
    rows.push({id,position,name:String(item.driver_name||item.tla||id),code:String(item.tla||''),number:String(item.racing_number||''),team:String(item.team_name||''),color:item.team_color,time:String(item.qualifying_time||''),delta:Number.isInteger(item.grid_delta)?item.grid_delta:null});
  }
  const counts=new Map();for(const row of rows)if(row.position>0)counts.set(row.position,(counts.get(row.position)||0)+1);
  // Duplicate/unknown slots remain visible in a separate list, never on top of another car.
  const grid=rows.filter(r=>r.position>0&&counts.get(r.position)===1).sort((a,b)=>a.position-b.position);
  return {grid,pit:rows.filter(r=>r.position===0),unassigned:rows.filter(r=>r.position==null||counts.get(r.position)>1),meeting:String(attrs.meeting_name||''),session:String(attrs.target_session_name||''),status:readable?String(attrs.status||packet?.payload?.state||''):'',source:String(attrs.source||''),updated:attrs.source_updated_at||'',blocked:packet?.status==='blocked',loading:!resource||['loading','refreshing'].includes(resource.status)&&!packet,stale:packet?.status==='stale'||['error','disconnected','refreshing'].includes(resource?.status),available:readable};
}
