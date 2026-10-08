import asyncio
import base64
import copy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend import board_flash
from backend.hardware import BOARD_CONFIG, HardwareService, RuntimeBridge, create_router
from backend.security import SecurityMiddleware


class Process:
    def __init__(self, stdout=b'', stderr=b'', code=0, blocked=False):
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stdout.feed_data(stdout)
        self.stderr.feed_data(stderr)
        self.stdout.feed_eof()
        self.stderr.feed_eof()
        self.returncode = None
        self.code = code
        self.blocked = blocked
        self.pid = 12345

    async def wait(self):
        if self.blocked:
            await asyncio.Event().wait()
        self.returncode = self.code
        return self.code


@pytest.fixture
def setup(tmp_path, monkeypatch):
    service = HardwareService(tmp_path / 'projects', runtime=RuntimeBridge(timeout=0.1))
    service.compiler.executable = __file__
    project = service.create_project(board='arduino-uno')
    cfg = BOARD_CONFIG[project['board']]
    artifact = {'id': 'compiled', 'board': project['board'], 'fqbn': cfg['fqbn'],
                'format': 'hex', 'hex': ':00000001FF\n', 'source': project['firmware']['source'],
                'source_revision': 1, 'project_revision': 1}
    with service.lock:
        stored = service._load(project['id'])
        stored['compiler'] = {'status': 'simulation_ready', 'board': project['board'], 'fqbn': cfg['fqbn'],
                              'source_revision': 1, 'project_revision': 1, 'source': project['firmware']['source'],
                              'errors': [], 'artifact': artifact}
        stored['_artifacts'] = {'compiled': copy.deepcopy(artifact)}
        service._save(stored)
    listing = {'detected_ports': [{'port': {'address': 'COM7', 'protocol': 'serial', 'label': 'USB'},
                                   'matching_boards': [{'name': 'Uno', 'fqbn': cfg['fqbn']}]}]}
    state = SimpleNamespace(service=service, project=project, listing=listing, uploads=[], code=0,
                            stderr=b'', block=False, process=None)

    async def spawn(*args, **kwargs):
        assert kwargs['stdout'] == asyncio.subprocess.PIPE
        if args[1] == 'board':
            assert args[1:] == ('board', 'list', '--format', 'json')
            return Process(json.dumps(state.listing).encode())
        assert args[1] == 'upload'
        state.uploads.append(args)
        if '--input-file' in args:
            path = Path(args[args.index('--input-file') + 1])
            state.input_path = path
            state.input_bytes = path.read_bytes()
        else:
            path = Path(args[args.index('--input-dir') + 1])
            state.input_path = path
            state.input_bytes = {item.name: item.read_bytes() for item in path.iterdir()}
        state.process = Process(b'Uploader output', state.stderr, state.code, state.block)
        return state.process

    state.spawn = AsyncMock(side_effect=spawn)
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', state.spawn)
    app = FastAPI()
    app.include_router(create_router(service))
    state.client = TestClient(SecurityMiddleware(app, production=False, access_token=''))
    state.payload = {'port': 'COM7', 'expected_revision': 1, 'source_revision': 1, 'confirm': True}
    yield state
    state.client.close()


def post(state, **changes):
    return state.client.post(f'/api/hardware/projects/{state.project["id"]}/flash',
                             json={**state.payload, **changes})


def test_router_devices_real_discovery_filters(setup):
    setup.listing['detected_ports'].extend([
        {'port': {'address': '/dev/ttyUSB0', 'protocol': 'serial'}},
        {'port': {'address': '192.168.1.2', 'protocol': 'network'}},
        {'port': {'address': '--config-file=bad', 'protocol': 'serial'}},
    ])
    response = setup.client.get('/api/hardware/devices')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert [item['port'] for item in response.json()['devices']] == ['COM7', '/dev/ttyUSB0']
    assert response.json()['devices'][1]['unknown'] is True


@pytest.mark.parametrize('code', [0, 1])
def test_upload_actual_hex_and_truthful_failure(setup, code):
    setup.code = code
    setup.stderr = b'Port busy' if code else b''
    response = post(setup)
    assert response.status_code == 200
    assert response.json()['success'] is (code == 0)
    assert response.json()['returncode'] == code
    assert response.json()['stdout'] == 'Uploader output'
    assert response.json()['stderr'] == setup.stderr.decode()
    assert setup.input_bytes == b':00000001FF\n'
    assert not setup.input_path.exists()
    assert setup.uploads[0][2:6] == ('-p', 'COM7', '--fqbn', 'arduino:avr:uno')
    assert not board_flash._ACTIVE_PROJECTS and not board_flash._ACTIVE_PORTS


@pytest.mark.parametrize('changes,status', [
    ({'confirm': False}, 400), ({'confirm': 'true'}, 422),
    ({'expected_revision': 2}, 409), ({'source_revision': 2}, 409),
    ({'expected_revision': True}, 422), ({'port': '--help'}, 400),
    ({'port': 'COM7 --help'}, 400), ({'port': '/tmp/firmware'}, 400),
    ({'fqbn': 'arduino:avr:mega'}, 422), ({'executable': 'malicious'}, 422),
    ({'firmware': ':00000001FF'}, 422), ({'force_board_mismatch': True}, 422),
])
def test_payload_rejects_unsafe_input(setup, changes, status):
    assert post(setup, **changes).status_code == status
    assert not setup.uploads


@pytest.mark.parametrize('field,value', [('status', 'error'), ('stale', True), ('board', 'arduino-mega'),
                                         ('fqbn', 'arduino:avr:mega'), ('source', 'changed'),
                                         ('source_revision', 2), ('project_revision', 2)])
def test_compilation_validation(setup, field, value):
    stored = setup.service._load(setup.project['id'])
    stored['compiler'][field] = value
    setup.service._save(stored)
    assert post(setup).status_code == 409
    assert not setup.uploads


@pytest.mark.parametrize('field,value', [('board', 'arduino-mega'), ('fqbn', 'arduino:avr:mega'),
                                         ('source_revision', 2), ('project_revision', 2),
                                         ('format', 'bin'), ('source', 'changed'), ('hex', 'invalid')])
def test_artifact_validation(setup, field, value):
    stored = setup.service._load(setup.project['id'])
    stored['compiler']['artifact'][field] = value
    setup.service._save(stored)
    assert post(setup).status_code == 409
    assert not setup.uploads


def test_missing_and_mismatched_ports_unknown_confirmed(setup):
    setup.listing['detected_ports'][0]['matching_boards'][0]['fqbn'] = 'arduino:avr:mega'
    assert post(setup).status_code == 409
    setup.listing['detected_ports'][0]['matching_boards'] = []
    assert post(setup).json()['success'] is True
    setup.listing['detected_ports'] = []
    assert post(setup).status_code == 409
    assert len(setup.uploads) == 1


def test_optionless_detection_matches_configured_nano_options(setup):
    stored = setup.service._load(setup.project['id'])
    stored['board'] = 'arduino-nano'
    cfg = BOARD_CONFIG['arduino-nano']
    for record in (stored['compiler'], stored['compiler']['artifact']):
        record.update(board='arduino-nano', fqbn=cfg['fqbn'])
    setup.service._save(stored)
    setup.listing['detected_ports'][0]['matching_boards'][0]['fqbn'] = 'arduino:avr:nano'
    assert post(setup).json()['success'] is True


@pytest.mark.parametrize('running,status', [(True, 409), (False, 200), (None, 409)])
def test_running_runtime_rejected(setup, running, status):
    setup.service.runtime.sessions[setup.project['id']] = object()
    setup.service.runtime.command = AsyncMock(return_value={'result': {'running': running}})
    assert post(setup).status_code == status
    setup.service.runtime.command.assert_awaited_once_with(setup.project['id'], 'read_simulation_results', {})


def test_revision_rechecked_after_detection(setup):
    original = setup.spawn.side_effect

    async def changed(*args, **kwargs):
        process = await original(*args, **kwargs)
        stored = setup.service._load(setup.project['id'])
        stored['revision'] += 1
        setup.service._save(stored)
        return process

    setup.spawn.side_effect = changed
    assert post(setup).status_code == 409
    assert not setup.uploads


@pytest.mark.parametrize('route', ['/api/hardware/devices', '/api/hardware/projects/project/flash'])
def test_local_only_and_security(setup, route):
    method = setup.client.get if route.endswith('devices') else setup.client.post
    assert method(route, headers={'host': 'remote.example'}).status_code == 403
    assert method(route, headers={'origin': 'https://evil.example'}).status_code == 403
    app = FastAPI()
    app.include_router(board_flash.create_router(setup.service))
    with TestClient(SecurityMiddleware(app, production=True, access_token='secret')) as client:
        assert client.get('/api/hardware/devices').status_code == 401
        assert client.get('/api/hardware/devices', headers={'authorization': 'Bearer secret'}).status_code == 200
    with TestClient(app, client=('192.0.2.10', 1234)) as client:
        assert client.get('/api/hardware/devices').status_code == 403
    assert not setup.uploads


@pytest.mark.parametrize('listing', [{ 'detected_ports': 'bad'}, 'not-json'])
def test_invalid_discovery_data(setup, listing):
    setup.listing = listing
    assert setup.client.get('/api/hardware/devices').status_code == 502


def test_missing_cli(setup):
    setup.service.compiler.executable = None
    assert setup.client.get('/api/hardware/devices').status_code == 503
    setup.spawn.assert_not_called()


def test_timeout_and_output_limit_cleanup(setup, monkeypatch):
    from backend.hardware import ArduinoCompiler
    terminate = AsyncMock(side_effect=lambda process: setattr(process, 'returncode', -9))
    monkeypatch.setattr(ArduinoCompiler, '_terminate', lambda self, process: terminate(process))
    setup.block = True
    monkeypatch.setattr(board_flash, 'FLASH_TIMEOUT', 0.01)
    assert post(setup).status_code == 504
    assert not setup.input_path.exists()
    assert not board_flash._ACTIVE_PORTS
    assert terminate.await_count == 1
    setup.block = False
    monkeypatch.setattr(board_flash, 'OUTPUT_LIMIT', 10)
    assert setup.client.get('/api/hardware/devices').status_code == 502


def test_project_and_port_global_lock(setup):
    payload = board_flash.FlashRequest(**setup.payload)
    for target, key in [(board_flash._ACTIVE_PROJECTS, setup.project['id']), (board_flash._ACTIVE_PORTS, 'COM7')]:
        target.add(key)
        try:
            with pytest.raises(HTTPException) as error:
                asyncio.run(board_flash.flash(setup.service, setup.project['id'], payload))
            assert error.value.status_code == 409
        finally:
            target.discard(key)
    setup.spawn.assert_not_called()


def test_cancelled_upload_terminates_child_and_removes_files(setup, monkeypatch):
    from backend.hardware import ArduinoCompiler
    terminate = AsyncMock(side_effect=lambda process: setattr(process, 'returncode', -9))
    monkeypatch.setattr(ArduinoCompiler, '_terminate', lambda self, process: terminate(process))
    setup.block = True

    async def cancelled():
        task = asyncio.create_task(board_flash.flash(setup.service, setup.project['id'], board_flash.FlashRequest(**setup.payload)))
        while not setup.uploads:
            await asyncio.sleep(0)
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancelled())
    terminate.assert_awaited_once()
    assert not setup.input_path.exists()
    assert not board_flash._ACTIVE_PORTS


def test_disconnect_cancels_operation():
    cancelled = []

    async def operation():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    async def run():
        with pytest.raises(HTTPException) as error:
            await board_flash.until_disconnect(SimpleNamespace(receive=AsyncMock(return_value={'type': 'http.disconnect'})), operation())
        assert error.value.status_code == 499

    asyncio.run(run())
    assert cancelled == [True]


@pytest.mark.parametrize('board_id', ['esp32-devkit-v1', 'esp32-s3', 'esp32-c3'])
def test_esp_upload_reconstructs_actual_segments(setup, board_id):
    cfg = BOARD_CONFIG[board_id]
    binary = bytearray(b'\xff' * cfg['flash_size_bytes'])
    segments = []
    expected = {}
    for index, ((name, filename), offset) in enumerate(zip(board_flash.ESP_SEGMENTS, [cfg['bootloader_offset'], 0x8000, 0xe000, 0x10000])):
        data = bytes([index + 1]) * 64
        binary[offset:offset + len(data)] = data
        segments.append({'name': name, 'filename': filename, 'offset': offset, 'size_bytes': len(data)})
        expected[filename] = data
    stored = setup.service._load(setup.project['id'])
    stored['board'] = board_id
    stored['compiler'].update(board=board_id, fqbn=cfg['fqbn'], status='compilation_complete')
    artifact = stored['compiler']['artifact']
    artifact.update(board=board_id, fqbn=cfg['fqbn'], format='bin', encoding='base64',
                    bin=base64.b64encode(binary).decode(), image_kind='merged-flash', load_address=0,
                    chip=cfg['chip'], flash_segments=segments)
    setup.service._save(stored)
    setup.listing['detected_ports'][0]['matching_boards'] = []
    assert post(setup).json()['success'] is True
    assert setup.input_bytes == expected
    assert '--input-file' not in setup.uploads[0]
    recipe = setup.uploads[0][setup.uploads[0].index('--upload-property') + 1]
    assert '0xe000 "{build.path}/boot_app0.bin"' in recipe
    assert '0x10000 "{build.path}/{build.project_name}.bin"' in recipe
    assert not setup.input_path.exists()


def test_invalid_esp_segments_do_not_write_arbitrary_files(tmp_path):
    cfg = BOARD_CONFIG['esp32-c3']
    artifact = {'encoding': 'base64', 'image_kind': 'merged-flash', 'load_address': 0, 'chip': cfg['chip'],
                'bin': base64.b64encode(bytes(cfg['flash_size_bytes'])).decode(),
                'flash_segments': [{'filename': '../bad', 'name': 'bootloader', 'offset': 0, 'size_bytes': 64}] * 4}
    with pytest.raises(HTTPException):
        board_flash.upload_input(tmp_path, cfg, artifact)
    assert not list(tmp_path.iterdir())
