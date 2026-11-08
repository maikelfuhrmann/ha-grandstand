"""Public F1 result tables, scoped to a calendar weekend; no timing credentials."""
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import re

from .model import parse_time

F1_SITE = 'https://www.formula1.com'
# Circuit IDs are stable Jolpica identities. Race IDs are discovered, never guessed.
CIRCUIT_SLUGS = dict(zip(
    'albert_park shanghai suzuka bahrain jeddah miami imola monaco villeneuve catalunya red_bull_ring silverstone spa hungaroring zandvoort monza madring baku marina_bay americas rodriguez interlagos vegas losail yas_marina'.split(),
    'australia china japan bahrain saudi-arabia miami emilia-romagna monaco canada barcelona-catalunya austria great-britain belgium hungary netherlands italy spain azerbaijan singapore united-states mexico brazil las-vegas qatar abu-dhabi'.split(),
))


class ResultPage(HTMLParser):
    """Read visible table cells/links only; ignore scripts and mobile duplicate names."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links=[]; self.tables=[]; self.notes=[]; self.stack=[]
        self.table=None; self.row=None; self.cell=None; self.note=[]

    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag=='a' and (href:=attrs.get('href','')).startswith('/en/results/'):
            self.links.append(href)
        if tag in ('img','br','hr','input','meta','link','source','wbr'):return
        hidden=tag in ('script','style','svg') or 'md:hidden' in attrs.get('class','').split()
        self.stack.append((tag,hidden))
        if tag=='table':self.table=[]
        if self.table is not None and tag=='tr':self.row=[]
        if self.row is not None and tag in ('td','th'):self.cell=[]

    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()));self.cell=None
        if tag=='tr' and self.row is not None:
            self.table.append(self.row);self.row=None
        if tag=='table' and self.table is not None:
            self.tables.append(self.table);self.table=None
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                del self.stack[i:];break

    def handle_data(self,data):
        if any(hidden for _,hidden in self.stack):return
        if self.cell is not None:self.cell.append(data)
        text=' '.join(data.split())
        if text.startswith('Note -'):self.notes.append(text[:1500])


def parse_result_page(raw):
    parser=ResultPage();parser.feed(raw.decode('utf-8-sig') if isinstance(raw,(bytes,bytearray)) else raw)
    return {'links':list(dict.fromkeys(parser.links))[:250], 'tables':parser.tables[:4], 'notes':parser.notes[:4]}


def result_root(page,season,circuit):
    slug=CIRCUIT_SLUGS.get(circuit)
    if not slug or not re.fullmatch(r'20\d{2}',str(season)):return None
    pattern=rf'/en/results/{season}/races/\d+/{re.escape(slug)}/race-result'
    links={link for link in page.get('links',[]) if re.fullmatch(pattern,link)}
    return F1_SITE+links.pop().rsplit('/',1)[0] if len(links)==1 else None


def result_rows(page,kind):
    required=['Pos.','No.','Driver','Team']+(['Q1','Q2','Q3'] if kind=='qualifying' else ['Time'])
    table=next((t for t in page.get('tables',[]) if t and all(key in t[0] for key in required)),[])
    if not table:return []
    rows=[];numbers=set();positions=set()
    for cells in table[1:41]:
        if len(cells)!=len(table[0]):return []
        row=dict(zip(table[0],cells));number=row['No.'];position=row['Pos.']
        if not re.fullmatch(r'\d{1,3}',number) or number in numbers:return []
        rank=int(position) if position.isdigit() and 1<=int(position)<=40 else 0 if position.upper() in ('PL','PIT','PIT LANE') else None
        if rank and rank in positions:return []
        numbers.add(number);positions.add(rank)
        lap=lambda key:row.get(key,'') if re.fullmatch(r'\d{1,2}:\d{2}\.\d{3}',row.get(key,'')) else ''
        rows.append({'position':rank,'position_label':position[:12],'number':number,'name':row['Driver'][:120],
                     'team':row['Team'][:120],'q1':lap('Q1'),'q2':lap('Q2'),'q3':lap('Q3'),'time':lap('Time')})
    return rows if len(rows)>=2 else []


def select_weekend(calendar,now=None):
    now=now or datetime.now(timezone.utc)
    races=sorted((r for r in calendar if parse_time(r.get('date'))),key=lambda r:r['date'])
    # Keep today's race through delays; between weekends retain the last result.
    current=next((r for r in races if now-timedelta(hours=10)<=parse_time(r['date'])<=now+timedelta(days=4)),None)
    past=[r for r in races if parse_time(r['date'])<now]
    return current or (past[-1] if past else races[0] if races else None)


def jolpica_qualifying(data,season,round_number):
    races=(data.get('MRData',{}).get('RaceTable',{}).get('Races') or [])
    race=next((r for r in races if str(r.get('season'))==str(season) and str(r.get('round'))==str(round_number)),{})
    rows=[]
    for row in race.get('QualifyingResults',[])[:40]:
        driver=row.get('Driver') or {};rank=str(row.get('position',''))
        if not rank.isdigit():continue
        rows.append({'position':int(rank),'position_label':rank,'number':str(row.get('number','')),
                     'name':(driver.get('givenName','')+' '+driver.get('familyName','')).strip(),
                     'code':driver.get('code',''),'team':(row.get('Constructor') or {}).get('name',''),
                     **{q.lower():str(row.get(q) or '') for q in ('Q1','Q2','Q3')}})
    return rows
