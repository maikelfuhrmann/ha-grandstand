"""On-demand, cached club dossiers and Formula 1 season data."""
import asyncio
from datetime import datetime, timedelta, timezone
import re
from urllib.parse import urlencode
from xml.etree.ElementTree import ParseError

import aiohttp

from .catalog import LEAGUES
from .const import API_ROOT, VERSION
from .enrichment_model import normalize_table, normalize_schedule, normalize_team, normalize_roster, normalize_news_xml, normalize_news_espn, normalize_f1
from .model import parse_time

LANGUAGES={'de':('DE','de'),'en':('US','en'),'es':('ES','es'),'fr':('FR','fr'),'it':('IT','it'),'nl':('NL','nl')}


class EnrichmentProvider:
    def __init__(self,session):
        self.session=session;self.cache={};self.pending={};self.semaphore=asyncio.Semaphore(4)

    async def get(self,url,ttl=900,xml=False):
        now=datetime.now(timezone.utc);cached=self.cache.get(url)
        if cached and cached['expires']>now:return cached
        if url in self.pending:return await asyncio.shield(self.pending[url])
        async def fetch():
            old=self.cache.get(url,{})
            try:
                async with self.semaphore:
                    async with self.session.get(url,headers={'User-Agent':f'HA-Sports-Hub/{VERSION}'},timeout=aiohttp.ClientTimeout(total=18)) as response:
                        response.raise_for_status()
                        raw=bytearray()
                        async for chunk in response.content.iter_chunked(65536):
                            raw.extend(chunk)
                            if len(raw)>4_000_000:raise ValueError('Response too large')
                        import json
                        data=normalize_news_xml(raw,now) if xml else json.loads(raw)
                        if not isinstance(data,list if xml else dict):raise ValueError('Unexpected response')
                item={'data':data,'updated_at':now.isoformat(),'error':False,'expires':now+timedelta(seconds=ttl)}
            except (aiohttp.ClientError,asyncio.TimeoutError,ValueError,TypeError,ParseError):
                item={'data':old.get('data',[] if xml else {}),'updated_at':old.get('updated_at'),'error':True,'expires':now+timedelta(seconds=120)}
            if len(self.cache)>=256:self.cache.pop(next(iter(self.cache)))
            self.cache[url]=item
            return item
        task=asyncio.create_task(fetch());self.pending[url]=task
        task.add_done_callback(lambda done: self.pending.pop(url,None))
        return await asyncio.shield(task)

    async def news(self,name,lang,league,team_id=None):
        country,language=LANGUAGES.get(lang,LANGUAGES['en'])
        query='"'+name.replace('"','')[:100]+'" when:14d'
        url='https://news.google.com/rss/search?'+urlencode({'q':query,'hl':language,'gl':country,'ceid':country+':'+language})
        item=await self.get(url,900,True)
        articles=item['data']
        if not articles:
            path=f"{API_ROOT}/{league['sport']}/{league['path']}/news?"+urlencode({'limit':12,**({'team':team_id} if team_id else {})})
            fallback=await self.get(path,1800)
            articles=normalize_news_espn(fallback['data'],team_id)
            item=fallback
        return {'articles':articles,'updated_at':item['updated_at'],'stale':item['error']}

    def resolve(self,profile,snapshot):
        if profile['kind']=='league':return LEAGUES.get(profile['target']),None
        match=re.search(r'(?:~t:|:team:)(\d+)$',profile['target'])
        team_id=match.group(1) if match else None
        league=LEAGUES.get(profile.get('league_id'))
        if league and league['sport']!=profile['sport']:league=None
        if not league:
            for event in snapshot.get('events',[]):
                if event['sport']==profile['sport'] and any(p['key']==profile['target'] for p in event['participants']):
                    league=LEAGUES.get(event['league_id']);break
        if not league and profile['sport']=='soccer':league=LEAGUES['soccer:ger.1']  # Soccer lookup below uses all leagues, then resolves the actual domestic league.
        if not league:
            # A team ID is only unique within its league. Never guess NBA vs WNBA, etc.
            league=None
        return league,team_id

    async def context(self,profile,snapshot,lang='en'):
        league,team_id=self.resolve(profile,snapshot)
        if not league:return {'key':profile['key'],'kind':'unavailable','events':[],'sources':[]}
        if league['id']=='racing:f1':return await self.f1(profile,lang)
        sources=[]
        def source(label,item):
            sources.append({'name':label,'updated_at':item['updated_at'],'stale':item['error']})
        info={};events=[];roster=[];tables=[];competitions=[]
        if team_id:
            lookup='all' if league['sport']=='soccer' else league['path']
            root=f"{API_ROOT}/{league['sport']}/{lookup}/teams/{team_id}"
            meta=await self.get(root,3600);source('ESPN · Club',meta)
            info=normalize_team(meta['data'])
            domestic=LEAGUES.get(f"{league['sport']}:{info['league_slug']}")
            if domestic:league=domestic
            if not info['id']:
                # Never replace a selected team with an arbitrary league/ID match.
                return {'key':profile['key'],'kind':'team','team':info,'events':[],'roster':[],'tables':[],'competitions':[],'news':await self.news(profile['name'],lang,league,team_id),'sources':sources}
            roster_root=f"{API_ROOT}/{league['sport']}/{league['path']}/teams/{team_id}"
            past,future,squad=await asyncio.gather(self.get(root+'/schedule',900),self.get(root+'/schedule?fixture=true',1800),self.get(roster_root+'/roster',21600))
            source('ESPN · Results',past);source('ESPN · Fixtures',future);source('ESPN · Squad',squad)
            unique={}
            for item in (past,future):
                for event in normalize_schedule(item['data'],league,team_id):
                    event.update({'updated_at':item['updated_at'],'stale':item['error']})
                    for participant in event['participants']:
                        if participant['id']==team_id:participant['key']=profile['target']
                        elif league['sport']=='soccer':participant['key']=f"soccer:s:600~t:{participant['id']}"
                    unique[event['id']]=event
            events=sorted(unique.values(),key=lambda e:e['date']);roster=normalize_roster(squad['data'])
            # Use the selected team's own home fixture for stadium details when metadata omits it.
            if not info['venue']:
                home=next((e for e in events if e.get('venue') and any(p['id']==team_id and p['home_away']=='home' for p in e['participants'])),None)
                if home:info['venue']=home['venue']
            competition_ids=list(dict.fromkeys([league['id']]+[e['league_id'] for e in events]))[:12]
        else:
            competition_ids=[league['id']]
            # ESPN rejects long day ranges; fetch calendar months for the provider's
            # actual season (which can cross New Year), only for the opened league.
            root=f"{API_ROOT}/{league['sport']}/{league['path']}/scoreboard"
            current=await self.get(root,900)
            season=(current['data'].get('leagues') or [{}])[0].get('season') or {}
            start=parse_time(season.get('startDate'));end=parse_time(season.get('endDate'))
            now=datetime.now(timezone.utc)
            if not start or not end or end<start or (end-start).days>550:
                start=now.replace(month=1,day=1);end=now.replace(month=12,day=31)
            cursor=start.replace(day=1);months=[]
            while cursor<=end and len(months)<18:
                months.append(cursor.strftime('%Y%m'))
                cursor=(cursor.replace(day=28)+timedelta(days=4)).replace(day=1)
            items=await asyncio.gather(*(self.get(root+'?'+urlencode({'dates':month,'limit':1000}),900 if month==now.strftime('%Y%m') else 21600) for month in months))
            unique={}
            for item in items:
                payload=item['data']
                if season.get('year'):
                    payload={**payload,'events':[e for e in payload.get('events',[]) if (e.get('season') or {}).get('year')==season['year']]}
                for event in normalize_schedule(payload,league):
                    event.update({'updated_at':item['updated_at'],'stale':item['error']});unique[event['id']]=event
            events=sorted(unique.values(),key=lambda e:e['date'])
            sources.append({'name':'ESPN · Season','updated_at':min((i['updated_at'] for i in items if i['updated_at']),default=None),'stale':current['error'] or any(i['error'] for i in items)})
        async def competition(key):
            selected=LEAGUES.get(key)
            if not selected:return None,None
            data=await self.get(f"https://site.api.espn.com/apis/v2/sports/{selected['sport']}/{selected['path']}/standings",900)
            table=normalize_table(data['data'],selected);table.update({'updated_at':data['updated_at'],'stale':data['error']})
            matching=[e for e in events if e['league_id']==key]
            own=next((row for group in table['groups'] for row in group['entries'] if row['team']['id']==team_id),None)
            comp={'id':key,'name':selected['name'],'tournament':any(e.get('tournament') for e in matching),'played':sum(e['state']=='finished' for e in matching),'upcoming':sum(e['state']=='scheduled' for e in matching),'round':next((e.get('round') for e in matching if e['state']=='scheduled' and e.get('round')),''),'rank':own['rank'] if own else None,'points':own['stats'].get('points',{}).get('display') if own else None}
            return comp,table
        rows,news=await asyncio.gather(asyncio.gather(*(competition(k) for k in competition_ids)),self.news(info.get('name') or profile['name'],lang,league,team_id))
        for comp,table in rows:
            if comp:competitions.append(comp)
            if table and table['groups']:tables.append(table);sources.append({'name':'ESPN · '+table['name'],'updated_at':table['updated_at'],'stale':table['stale']})
        return {'key':profile['key'],'kind':'team' if team_id else 'league','primary_league':league['id'],'team':info,'events':events,'roster':roster,'tables':tables,'competitions':competitions,'news':news,'sources':sources,'generated_at':datetime.now(timezone.utc).isoformat()}

    async def f1(self,profile,lang):
        base='https://api.jolpi.ca/ergast/f1/current'
        items=await asyncio.gather(*(self.get(base+path,3600) for path in ['.json?limit=100','/driverStandings.json?limit=100','/constructorStandings.json?limit=100','/last/results.json?limit=100']))
        data=normalize_f1(*(i['data'] for i in items));news=await self.news('Formula 1',lang,LEAGUES['racing:f1'])
        return {'key':profile['key'],'kind':'f1','f1':data,'events':[],'news':news,'sources':[{'name':'Jolpica · '+label,'updated_at':i['updated_at'],'stale':i['error']} for label,i in zip(['Calendar','Drivers','Constructors','Results'],items)],'generated_at':datetime.now(timezone.utc).isoformat()}
