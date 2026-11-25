"""Package the manual POC, without hosting identity or archived Excel data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys
base = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]) if len(sys.argv) > 1 else base.parent / 'outputs' / 'POC-Cockpit-CDS-Manuel.zip'
output.parent.mkdir(parents=True, exist_ok=True)
files = [*base.joinpath('dist').glob('*'), base / 'tests' / 'manual.test.mjs']
files += [base / 'README.md', base / 'docs' / 'POC_COCKPIT_CDS.md', base / 'docs' / 'VALIDATION.md', Path(__file__).resolve()]
package = json.loads((base / 'package.json').read_text())
package['scripts']['test'] = 'node --test tests/manual.test.mjs'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in files:
        if path.is_file():
            archive.write(path, Path('poc-cockpit') / path.relative_to(base))
    archive.writestr('poc-cockpit/package.json', json.dumps(package, indent=2) + '\n')
print(output)
