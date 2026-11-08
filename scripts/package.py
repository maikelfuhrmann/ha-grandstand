"""Create a reproducible manual-install ZIP without credentials, caches or test data."""
from pathlib import Path
import json
import zipfile

root=Path(__file__).resolve().parents[1]
component=root/'custom_components/sports_hub'
version=json.loads((component/'manifest.json').read_text())['version']
target=root/'build'/f'ha-sports-hub-{version}.zip'
target.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(component.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix=='.pyc':continue
        info=zipfile.ZipInfo(path.relative_to(root).as_posix(),date_time=(2026,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o644<<16
        archive.writestr(info,path.read_bytes())
print(target)
