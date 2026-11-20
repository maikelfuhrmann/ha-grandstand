"""Practice classifications and tyre usage, bound to one published session."""
from datetime import datetime, timedelta, timezone
import math
import re

from .model import parse_time

COMPOUNDS={'SOFT','MEDIUM','HARD','INTERMEDIATE','WET'}


def integer(value,minimum=0,maximum=500):
    if isinstance(value,bool):return None
    try:number=float(value)
    except (ValueError,TypeError):return None
    return int(number) if math.isfinite(number) and number.is_integer() and minimum<=number<=maximum else None


def seconds(value):
    if isinstance(value,bool):return None
    try:number=float(value)
    except (ValueError,TypeError):return None
    return number if math.isfinite(number) and 0<number<3600 else None


def practice_sessions(race,published,now=None):
    now=now or datetime.now(timezone.utc);sessions=[]
    for slot in (race or {}).get('sessions',[]):
        if slot.get('name') not in ('FP1','FP2','FP3'):continue
        start=parse_time(slot.get('date'))
        if not start:continue
        number=int(slot['name'][-1])
        matches=[s for s in published if isinstance(s,dict) and s.get('session_type')=='Practice'
                 and s.get('session_name')==f'Practice {number}' and str(s.get('year'))==str(start.year)
                 and parse_time(s.get('date_start')) and abs((parse_time(s['date_start'])-start).total_seconds())<=6*3600]
        found=matches[0] if len(matches)==1 else {}
        end=parse_time(found.get('date_end'));actual=parse_time(found.get('date_start')) or start
        sessions.append({'number':number,'name':slot['name'],'date':actual.isoformat(),'end':end.isoformat() if end else None,
            'session_key':integer(found.get('session_key'),1,999999),'meeting_key':integer(found.get('meeting_key'),1,999999),
            'state':'cancelled' if found.get('is_cancelled') else 'scheduled' if now<actual else 'finished' if end and now>=end else 'pending',
            'archive_ready':bool(end and now>=end+timedelta(minutes=30) and not found.get('is_cancelled'))})
    return sorted(sessions,key=lambda s:s['number'])


def official_practice_rows(page):
    required=('Pos.','No.','Driver','Team','Laps')
    table=next((t for t in page.get('tables',[]) if t and all(k in t[0] for k in required)),[])
    rows=[];seen=set()
    for cells in table[1:41]:
        if len(cells)!=len(table[0]):return []
        row=dict(zip(table[0],cells));number=integer(row.get('No.'),1,999)
        if number is None or number in seen:return []
        seen.add(number);clock=row.get('Time') or row.get('Time / Gap') or ''
        match=re.fullmatch(r'(\d{1,2}):(\d{2}\.\d{3})',clock)
        rows.append({'driver_number':number,'position':integer(row.get('Pos.'),1,40),'number_of_laps':integer(row.get('Laps')),
            'name':row['Driver'][:120],'team':row['Team'][:120], 'duration':int(match[1])*60+float(match[2]) if match else None,
            'gap_label':row.get('Gap') or (clock if not match else ''),'classification_source':'Formula1.com'})
    return rows


def practice_rows(session,results,drivers,stints,laps,official=None):
    """Never double-count overlaps, tyre starting age, or an unfinished final lap."""
    key=session.get('session_key');meeting=session.get('meeting_key')
    def scoped(rows):
        return [r for r in rows if isinstance(r,dict) and key is not None and r.get('session_key')==key
                and (meeting is None or r.get('meeting_key')==meeting)]
    people={integer(d.get('driver_number'),1,999):d for d in scoped(drivers)}
    classified={integer(r.get('driver_number'),1,999):r for r in scoped(results)}
    for row in official or []:classified.setdefault(row['driver_number'],row)
    tyre_rows=scoped(stints);lap_rows=scoped(laps);rows=[]
    if not classified:
        # Exploratory/out-laps can exist without a published classification (e.g. wet FP1).
        # These are explicitly recorded lap entries, not an inferred official lap total.
        for lap in lap_rows:
            number=integer(lap.get('driver_number'),1,999)
            if number and integer(lap.get('lap_number'),1):classified.setdefault(number,{'recorded_only':True})
    for number,result in classified.items():
        if number is None:continue
        person=people.get(number,{})
        total=integer(result.get('number_of_laps'))
        driver_laps={integer(l.get('lap_number'),1):l for l in lap_rows if l.get('driver_number')==number and integer(l.get('lap_number'),1) is not None}
        recorded=bool(result.get('recorded_only'))
        if recorded:total=len(driver_laps)
        # A published classification is authoritative; otherwise only observed completed laps qualify.
        completed=set(driver_laps) if recorded else set(range(1,total+1)) if total is not None else {n for n,l in driver_laps.items() if seconds(l.get('lap_duration')) is not None}
        ranges=[];seen=set()
        for stint in tyre_rows:
            if stint.get('driver_number')!=number:continue
            start=integer(stint.get('lap_start'),1);end=integer(stint.get('lap_end'),1);index=integer(stint.get('stint_number'),1)
            if start is None or end is None or index is None or end<start:continue
            compound=str(stint.get('compound') or '').upper();compound=compound if compound in COMPOUNDS else 'UNKNOWN'
            token=(index,start,end,compound)
            if token in seen:continue
            seen.add(token);ranges.append({'number':index,'compound':compound,'start':start,'end':end,'tyre_age':integer(stint.get('tyre_age_at_start'))})
        assigned={};ambiguous=set()
        for stint in ranges:
            for n in range(stint['start'],stint['end']+1):
                if n not in completed:continue
                if n in assigned:ambiguous.add(n)
                else:assigned[n]=stint
        for n in ambiguous:assigned.pop(n,None)
        compounds={};normalized=[]
        for stint in sorted(ranges,key=lambda s:(s['start'],s['number'])):
            numbers=[n for n,s in assigned.items() if s is stint]
            if not numbers:continue
            compound=stint['compound']
            if compound!='UNKNOWN':compounds[compound]=compounds.get(compound,0)+len(numbers)
            timed=[seconds(driver_laps[n].get('lap_duration')) for n in numbers if n in driver_laps and driver_laps[n].get('is_pit_out_lap') is False]
            timed=[t for t in timed if t is not None]
            normalized.append({**stint,'laps':len(numbers),'start':min(numbers),'end':max(numbers),
                'best':min(timed) if timed else None,'timed_laps':len(timed)})
        accounted=sum(compounds.values());best=seconds(result.get('duration'))
        best_numbers=[n for n,l in driver_laps.items() if best and seconds(l.get('lap_duration')) is not None and abs(float(l['lap_duration'])-best)<0.002]
        best_compounds={assigned[n]['compound'] for n in best_numbers if n in assigned}
        gap=result.get('gap_to_leader');gap=float(gap) if isinstance(gap,(float,int)) and not isinstance(gap,bool) and math.isfinite(gap) and gap>=0 else None
        rows.append({'number':number,'position':integer(result.get('position'),1,40),
            'name':str(person.get('full_name') or result.get('name') or person.get('broadcast_name') or number)[:120],
            'code':str(person.get('name_acronym') or '')[:5],'team':str(person.get('team_name') or result.get('team') or '')[:120],
            'color':'#'+person['team_colour'] if re.fullmatch(r'[0-9a-fA-F]{6}',str(person.get('team_colour',''))) else '#8a97a7',
            'best':best,'gap':gap,'gap_label':str(result.get('gap_label') or '')[:30], 'laps':total,
            'compounds':compounds,'unassigned_laps':max(0,total-accounted) if total is not None else None,
            'stints':normalized,'best_compound':next(iter(best_compounds)) if len(best_compounds)==1 else None,
            'dsq':bool(result.get('dsq')),'recorded_only':recorded,'classification_source':result.get('classification_source','OpenF1')})
    return sorted(rows,key=lambda r:(r['position'] or 999,r['number']))
