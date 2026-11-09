import {dateKey,isFreshLive} from './model.js';

export function personalSections(events,now,zone){
 const ordered=[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 return {live:ordered.filter(e=>isFreshLive(e,now)),upcoming:ordered.filter(e=>e.state==='scheduled'&&Date.parse(e.date)>=now),
  results:ordered.filter(e=>e.state==='finished'&&!e.calendar_only).reverse(),today:ordered.filter(e=>dateKey(e.date,zone)===dateKey(now,zone))};
}
export function monthDays(month){
 const [year,number]=month.split('-').map(Number);const first=new Date(Date.UTC(year,number-1,1));
 const offset=(first.getUTCDay()+6)%7;return Array.from({length:42},(_,i)=>new Date(Date.UTC(year,number-1,1-offset+i)).toISOString().slice(0,10));
}
export function moveMonth(month,delta){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);}
export function mergePersonalEvents(base,extra){return [...new Map([...(extra||[]),...(base||[])].map(e=>[e.id,e])).values()];}
