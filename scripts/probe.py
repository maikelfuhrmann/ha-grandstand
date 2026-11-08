"""Check public provider responses and save a small local verification report."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalog", ROOT / "custom_components/sports_hub/catalog.py")
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
OUTPUT = ROOT / "tests/fixtures/live"
OUTPUT.mkdir(parents=True, exist_ok=True)

def probe(league):
    url = f"https://site.api.espn.com/apis/site/v2/sports/{league['sport']}/{league['path']}/scoreboard?dates=20261108&limit=1000"
    if "college" in league['path']:
        url += "&groups=50" if league['sport'] == 'basketball' else "&groups=80"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "HA-Sports-Hub/0.1.0 (coverage verification)"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
        if not isinstance(data.get("events"), list):
            raise ValueError("Missing events array")
        filename = league['id'].replace(':', '_') + '.json'
        (OUTPUT / filename).write_text(json.dumps(data))
        return {"id": league['id'], "name": league['name'], "ok": True, "events": len(data['events']), "reported_name": (data.get('leagues') or [{}])[0].get('name')}
    except Exception as exc:
        return {"id": league['id'], "name": league['name'], "ok": False, "error": str(exc)}

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(probe, catalog.LEAGUES.values()))
    (ROOT / 'docs/coverage-check.json').write_text(json.dumps({"checked_on": "2026-11-08", "note": "Endpoint validation; an empty scoreboard does not prove complete event coverage.", "leagues": results}, indent=2) + '\n')
    for result in results:
        print(json.dumps(result), flush=True)
    sys.exit(0 if all(r['ok'] for r in results) else 1)
