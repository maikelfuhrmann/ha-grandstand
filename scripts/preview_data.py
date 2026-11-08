"""Normalize downloaded public snapshots for local visual testing only."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from custom_components.sports_hub.catalog import LEAGUES, SPORTS
from custom_components.sports_hub.model import normalize_scoreboard

now=datetime.now(timezone.utc).isoformat()
start=datetime(2026,11,6,tzinfo=timezone.utc)
end=datetime(2026,11,16,tzinfo=timezone.utc)
events=[];leagues=[]
for league in LEAGUES.values():
    path=ROOT/'tests/fixtures/live'/(league['id'].replace(':','_')+'.json')
    normalized=normalize_scoreboard(json.loads(path.read_text()),league,start,end) if path.exists() else []
    events.extend({**event,'stale':False,'updated_at':now} for event in normalized)
    leagues.append({**league,'event_count':len(normalized),'live_count':sum(e['state']=='live' for e in normalized),'error':None,'partial':False,'loading':False,'updated_at':now})
data={'events':events,'leagues':leagues,'sports':[{'id':key,'name':v[0],'name_de':v[1],'icon':v[2]} for key,v in SPORTS.items()],'time_zone':'Europe/Berlin','generated_at':now,'window_start':start.isoformat(),'window_end':end.isoformat(),'version':'0.3.4','loading':False}
(ROOT/'docs/live-data.json').write_text(json.dumps(data))
print(f'{len(leagues)} leagues, {len(events)} competitions normalized')
