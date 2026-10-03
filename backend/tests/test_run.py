import asyncio
import logging
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest

from backend import run
from backend.app import create_app
from backend.hardware import ArduinoCompiler, HardwareService, create_router


@pytest.mark.parametrize('platform,reload,loop', [
    ('win32', False, 'backend.run:compiler_loop'),
    ('linux', True, 'auto'),
])
def test_launcher_loop_configuration(monkeypatch, platform, reload, loop):
    captured = {}
    monkeypatch.setattr(run.sys, 'platform', platform)
    monkeypatch.setattr(run, 'load_dotenv', lambda path: None)
    monkeypatch.setenv('BACKEND_PORT', '8001')
    monkeypatch.setattr(run.uvicorn, 'run', lambda app, **kwargs: captured.update(app=app, **kwargs))
    monkeypatch.setattr(logging.getLogger('uvicorn.error'), 'addFilter', lambda value: None)
    run.main()
    assert captured['app'] == 'backend.app:app'
    assert captured['host'] == '127.0.0.1'
    assert captured['port'] == 8001
    assert captured['reload'] is reload
    assert captured['loop'] == loop
    assert captured['access_log'] is False
    assert captured['reload_dirs'] == (['backend'] if reload else None)


def test_compiler_loop_launches_subprocess():
    async def execute():
        if sys.platform == 'win32':
            assert isinstance(asyncio.get_running_loop(), asyncio.ProactorEventLoop)
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-c', 'print(42)', stdout=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), 10)
        assert process.returncode == 0
        assert stdout.strip() == b'42'
    with asyncio.Runner(loop_factory=run.compiler_loop) as runner:
        runner.run(execute())


@pytest.mark.parametrize('message,args', [
    ('WebSocket /runtime?token=%s [accepted]', ('sensitive-value',)),
    ('WebSocket /runtime?other=1&token=sensitive-value&next=2 [accepted]', ()),
])
def test_websocket_log_redacts_runtime_token(message, args):
    record = logging.LogRecord('uvicorn.error', logging.INFO, '', 0, message, args, None)
    assert run.RuntimeTokenFilter().filter(record)
    assert 'sensitive-value' not in record.getMessage()
    assert 'token=[REDACTED]' in record.getMessage()


def test_actual_asgi_route_compiles_with_launcher_loop(tmp_path):
    compiler = ArduinoCompiler()
    if not compiler.executable or not Path(compiler.executable).is_file():
        pytest.skip('Arduino CLI is not installed.')
    service = HardwareService(data_dir=tmp_path, compiler=compiler)
    app = create_app(api_key='')
    app.router.routes = [route for route in app.router.routes if not getattr(route, 'path', '').startswith('/api/hardware')]
    app.include_router(create_router(service))
    with TestClient(app, backend_options={'loop_factory': run.compiler_loop}) as client:
        created = client.post('/api/hardware/projects', json={'name': 'ASGI compiler regression', 'board': 'arduino-uno'})
        assert created.status_code == 200
        project = created.json()
        response = client.post(f'/api/hardware/project/{project["id"]}/command',
                               json={'name': 'compile_firmware', 'args': {}})
        assert response.status_code == 200
        compiled = response.json()
        assert compiled['status'] == 'simulation_ready'
        artifact = client.get(compiled['artifact']['url'])
        assert artifact.status_code == 200
        assert artifact.text.startswith(':')
        assert ':00000001FF' in artifact.text
