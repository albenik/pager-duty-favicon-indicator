#!/usr/bin/env python3
"""Validate and package the unpacked extension without build-time dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=root / 'work' / 'release')
args = parser.parse_args()
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3
references = [manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_ui']['page']]
references += list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values())
for content in manifest['content_scripts']:
    references += content.get('js', []) + content.get('css', [])
for name in references:
    assert (extension / name).is_file(), f'Missing manifest resource: {name}'
args.out.mkdir(parents=True, exist_ok=True)
archive = args.out / f"pagerduty-signal-{manifest['version']}.zip"
with ZipFile(archive, 'w', ZIP_DEFLATED) as package:
    for file in sorted(extension.rglob('*')):
        if file.is_file():
            package.write(file, file.relative_to(root))
    for name in ['README.md', 'LICENSE']:
        package.write(root / name, name)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(args.out / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
print(f'Validated {len(references)} manifest resource references.')
print(f'Created {archive} ({archive.stat().st_size:,} bytes)')
print(f'SHA-256: {digest}')
