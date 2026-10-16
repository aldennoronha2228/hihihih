import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


def test_vercel_backend_preserves_repository_layout(tmp_path):
    config = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
    backend = config['services']['backend']
    assert backend['root'] == '.'
    assert backend['entrypoint'] == 'backend/vercel_app.py'
    assert (ROOT / 'requirements.txt').read_text(encoding='utf-8').strip() == '-r backend/requirements.txt'
    function = backend['functions']['backend/vercel_app.py']
    exclude = function['excludeFiles']
    assert 'node_modules/**' in exclude
    assert 'vendor/**' in exclude
    include = function['includeFiles']
    assert 'backend/catalog/**' in include
    assert 'vendor/velxio/frontend/public/components-metadata.json' in include

    bundle = tmp_path / 'function'
    (bundle / 'backend').mkdir(parents=True)
    for source in (ROOT / 'backend').glob('*.py'):
        shutil.copy2(source, bundle / 'backend' / source.name)
    for directory in ('backend/catalog', 'backend/templates'):
        shutil.copytree(ROOT / directory, bundle / directory)
    for filename in (
        'vendor/velxio/frontend/public/components-metadata.json',
    ):
        destination = bundle / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / filename, destination)
    script = '''
import importlib.util
from fastapi.testclient import TestClient
spec = importlib.util.spec_from_file_location('vercel_entrypoint', 'backend/vercel_app.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with TestClient(module.app) as client:
    for path in ('/api/health', '/api/hardware/projects', '/api/hardware/catalog?limit=1'):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code, response.text)
    response = client.post('/api/hardware/projects', json={'name': 'Bundle smoke', 'board': 'arduino-uno'})
    assert response.status_code == 200, response.text
'''
    env = {**os.environ, 'VERCEL': '1', 'WIREUP_DATA_DIR': str(tmp_path / 'projects')}
    env.pop('PYTHONPATH', None)
    result = subprocess.run(
        [sys.executable, '-c', script], cwd=bundle, env=env,
        capture_output=True, text=True, timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
