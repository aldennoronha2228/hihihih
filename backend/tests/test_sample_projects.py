import asyncio
import copy
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.hardware import BOARD_CONFIG, HardwareService, create_router as hardware_router
from backend.sample_projects import (
    EXAMPLES_PATH, STARTER_IDS, SampleCatalog, create_copy, create_router,
    example_source, normalize_template, router, service,
)
from backend.tests.test_hardware import FakeCompiler
from scripts.analyze_velxio_examples import analyze


@pytest.fixture
def hwservice(tmp_path):
    return HardwareService(tmp_path / 'projects', compiler=FakeCompiler())


@pytest.fixture
def client(hwservice):
    app = FastAPI()
    app.include_router(hardware_router(hwservice))
    app.include_router(create_router(hwservice))
    with TestClient(app) as client:
        yield client


def examples():
    return {example['id']: example for example in json.loads(EXAMPLES_PATH.read_text(encoding='utf-8'))}


def test_catalog_is_readonly_complete_and_truthful(client, hwservice):
    first = client.get('/api/hardware/samples')
    assert first.status_code == 200
    assert first.headers['cache-control'] == 'no-store'
    assert client.get('/api/hardware/samples').json() == first.json()
    samples = first.json()['samples']
    assert [sample['id'] for sample in samples] == list(STARTER_IDS)
    assert hwservice.list_projects()['projects'] == []
    assert not hwservice.data_dir.exists()
    for sample in samples:
        assert sample['available']
        assert sample['simulation'] == 'browser'
        assert sample['verification_status'] == {
            'canonical_validation': 'passed', 'real_compile': 'not_verified',
            'browser_run': 'not_verified', 'simulation_verified': False}
        assert sample['thumbnail'] == f'/starter-thumbnails/{sample["id"]}.webp'
        assert sample['provenance']['preview'] == f'examples-thumbs/{sample["id"]}.webp'
        assert sample['requirements']['libraries'] == []
        assert {'parts', 'wiring', 'pins', 'firmware', 'libraries', 'instructions', 'verification'} <= sample['requirements'].keys()
        assert not sample['provenance']['source_modified']


@pytest.mark.parametrize('sample_id', STARTER_IDS)
def test_open_canonical_copy_compile_and_edit(client, hwservice, sample_id):
    response = client.post(f'/api/hardware/samples/{sample_id}/open')
    assert response.status_code == 200, response.text
    project = response.json()
    second = client.post(f'/api/hardware/samples/{sample_id}/open').json()
    assert project['id'] != second['id']
    assert project['runtime_token'] != second['runtime_token']
    assert project['components'] == second['components']
    assert project['wires'] == second['wires']
    assert project['compiler'] is None
    assert project['board'] in BOARD_CONFIG
    assert project['components'][0]['id'] == 'board'
    assert project['firmware']['source'] == example_source(examples()[sample_id])
    assert HardwareService(hwservice.data_dir).get_project(project['id']) == {key: value for key, value in project.items() if key != 'setup_guidance'}
    assert 'Get started' in project['setup_guidance']
    operations = [entry['operation'] for entry in project['history']]
    assert operations == ['add_component'] * (len(project['components']) - 1) + ['connect_wire'] * len(project['wires']) + ['generate_firmware']
    compiled = client.post(f'/api/hardware/project/{project["id"]}/command', json={
        'name': 'compile_firmware', 'args': {'expected_revision': project['revision']}})
    assert compiled.status_code == 200
    assert compiled.json()['artifact']['board'] == project['board']
    assert compiled.json()['artifact']['format'] == BOARD_CONFIG[project['board']]['format']
    edited = client.post(f'/api/hardware/project/{project["id"]}/command', json={
        'name': 'edit_firmware', 'args': {'old': 'void setup()', 'new': 'void setup() /* edited */',
                                         'expected_revision': project['revision']}})
    assert edited.status_code == 200
    assert edited.json()['firmware']['revision'] == project['firmware']['revision'] + 1
    assert hwservice.get_project(second['id'])['firmware']['source'] == project['firmware']['source']
    assert client.get('/api/hardware/samples').json()['samples'][0]['verification_status']['real_compile'] == 'not_verified'


@pytest.mark.parametrize('sample_id,board,button_pin,led_pin', [
    ('button-led', 'arduino-uno', '2', '13'),
    ('nano-button-led', 'arduino-nano', '2', '13'),
    ('pico-button-led', 'pi-pico', 'GP2', 'GP3'),
])
def test_button_circuits_keep_real_series_resistors(client, sample_id, board, button_pin, led_pin):
    project = client.post(f'/api/hardware/samples/{sample_id}/open').json()
    assert project['board'] == board
    parts = {part['type']: part for part in project['components']}
    resistor = parts['resistor']
    led = parts['led']
    button = parts['pushbutton']
    assert resistor['properties']['value'] == '220'
    assert 'pin' not in led['properties']
    edges = {frozenset(((wire['from']['component'], wire['from']['pin']),
                       (wire['to']['component'], wire['to']['pin']))) for wire in project['wires']}
    expected = [(('board', led_pin), (resistor['id'], '1')),
                ((resistor['id'], '2'), (led['id'], 'A')),
                ((led['id'], 'C'), ('board', 'GND.1')),
                (('board', button_pin), (button['id'], '1.l')),
                ((button['id'], '2.l'), ('board', 'GND.1'))]
    assert edges == {frozenset(edge) for edge in expected}
    assert 'INPUT_PULLUP' in project['firmware']['source']


def test_pico_blink_onboard_adaptation(client):
    project = client.post('/api/hardware/samples/pico-blink/open').json()
    assert project['board'] == 'pi-pico'
    assert len(project['components']) == 1
    assert project['wires'] == []
    assert 'LED_BUILTIN' in project['firmware']['source']
    summary = next(sample for sample in client.get('/api/hardware/samples').json()['samples'] if sample['id'] == 'pico-blink')
    assert 'GP25' in summary['provenance']['adaptations'][0]
    assert not summary['provenance']['source_modified']


def test_unknown_and_nonlocal_requests(client, hwservice):
    assert client.post('/api/hardware/samples/unknown/open').status_code == 404
    for headers in ({'Origin': 'https://evil.example'}, {'Host': 'evil.example'}):
        assert client.get('/api/hardware/samples', headers=headers).status_code == 403
        assert client.post('/api/hardware/samples/button-led/open', headers=headers).status_code == 403
    assert hwservice.list_projects()['projects'] == []


def test_source_files_override_code_and_multifile_rejected(hwservice):
    example = copy.deepcopy(examples()['serial-hello'])
    example['files'] = [{'name': 'main.ino', 'content': 'void setup() {}\nvoid loop() {}'}]
    template = normalize_template(example, hwservice.catalog)
    assert template['source'] == example['files'][0]['content']
    example['files'].append({'name': 'other.ino', 'content': 'int n; '})
    with pytest.raises(ValueError, match='Multiple source files'):
        normalize_template(example, hwservice.catalog)


def test_current_board_id_maps_to_stable_board(hwservice):
    example = copy.deepcopy(examples()['button-led'])
    example['components'][0]['id'] = 'my-current-board'
    for wire in example['wires']:
        for side in ('start', 'end'):
            if wire[side]['componentId'] == 'arduino-uno':
                wire[side]['componentId'] = 'my-current-board'
    template = normalize_template(example, hwservice.catalog)
    assert all(endpoint['component'] != 'my-current-board' for wire in template['wires']
               for endpoint in (wire['from'], wire['to']))


@pytest.mark.parametrize('failure', ['component', 'wire', 'firmware'])
def test_open_uses_sequential_expected_revisions_and_rolls_back(hwservice, monkeypatch, failure):
    template = normalize_template(examples()['button-led'], hwservice.catalog)
    original = hwservice.command
    calls = []

    async def recording(project_id, name, args):
        calls.append((name, args['expected_revision']))
        return await original(project_id, name, args)

    monkeypatch.setattr(hwservice, 'command', recording)
    project = asyncio.run(create_copy(hwservice, template))
    assert [revision for _, revision in calls] == list(range(1, project['revision']))
    hwservice.delete_project(project['id'])
    if failure == 'component':
        template['parts'][0]['properties']['unknown'] = True
    elif failure == 'wire':
        template['wires'][0]['from']['pin'] = 'invalid'
    else:
        template['source'] = '\x00'
    with pytest.raises(HTTPException):
        asyncio.run(create_copy(hwservice, template))
    assert hwservice.list_projects()['projects'] == []


def test_all_templates_validate_before_any_publication(hwservice, tmp_path):
    data = list(examples().values())
    bad = next(example for example in data if example['id'] == 'pico-button-led')
    bad['components'][0]['properties']['unknown'] = True
    path = tmp_path / 'examples.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    catalog = SampleCatalog(hwservice, path)
    with pytest.raises(HTTPException):
        asyncio.run(catalog.validate())
    assert not catalog.validated
    assert hwservice.list_projects()['projects'] == []


def test_default_router_uses_shared_canonical_instance(monkeypatch):
    created = []
    original = service.create_project

    def record(*args, **kwargs):
        created.append(True)
        raise HTTPException(418, 'Shared service reached without creating persisted data.')

    monkeypatch.setattr(service, 'create_project', record)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post('/api/hardware/samples/serial-hello/open')
    assert response.status_code == 418
    assert created == [True]
    assert original is not None


def test_analysis_covers_all_examples_with_requirements_and_gaps():
    report = asyncio.run(analyze())
    assert report['total'] == len(report['examples']) == 321
    assert len({example['id'] for example in report['examples']}) == 321
    assert report['counts']['classification']['selected_starter'] == 6
    assert sum(report['counts']['classification'].values()) == 321
    for example in report['examples']:
        assert {'parts', 'wiring', 'pins', 'firmware', 'dependencies', 'instructions'} <= example['requirements'].keys()
        assert example['verification']['real_compile'] == 'not_verified'
        assert example['verification']['browser_run'] == 'not_verified'
    multi = next(example for example in report['examples'] if example['id'] == 'esp32-micropython-external-library')
    assert {'multi_file', 'unsupported_language'} <= {blocker['category'] for blocker in multi['blockers']}
