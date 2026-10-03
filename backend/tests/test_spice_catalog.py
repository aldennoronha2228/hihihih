import asyncio
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.hardware import BOARD_CONFIG, ComponentCatalog, HardwareService, SPICE_SOURCE_SCHEMAS, create_router


@pytest.fixture
def service(tmp_path):
    return HardwareService(tmp_path / 'projects')


@pytest.fixture
def client(service):
    app = FastAPI()
    app.include_router(create_router(service))
    with TestClient(app) as browser:
        yield browser


def command(client, project, name, args):
    return client.post(f'/api/hardware/project/{project["id"]}/command', json={'name': name, 'args': args})


@pytest.mark.parametrize('kind', list(SPICE_SOURCE_SCHEMAS))
def test_source_add_defaults_connect_and_persistence(client, service, kind):
    project = service.create_project(board='arduino-uno')
    entry = service.catalog.components[kind]
    result = command(client, project, 'add_component', {'id': 'source1', 'type': kind, 'expected_revision': 1})
    assert result.status_code == 200
    component = result.json()['components'][-1]
    assert component['properties'] == entry['defaultValues']
    assert entry['connectable'] and entry['schematic_only']
    pins = ['GND'] if kind == 'ground' else ['+', '-']
    assert entry['pins'] == pins
    command(client, project, 'add_component', {'id': 'resistor1', 'type': 'resistor'})
    for index, pin in enumerate(pins):
        response = command(client, project, 'connect_wire', {'from': {'component': 'source1', 'pin': pin},
                                                            'to': {'component': 'resistor1', 'pin': str(index + 1)}})
        assert response.status_code == 200
    bad = command(client, project, 'connect_wire', {'from': {'component': 'source1', 'pin': 'INVALID'},
                                                   'to': {'component': 'resistor1', 'pin': '1'}})
    assert bad.status_code == 400
    restored = HardwareService(service.data_dir).get_project(project['id'])
    assert restored['components'][1]['properties'] == entry['defaultValues']
    assert len(restored['wires']) == len(pins)


@pytest.mark.parametrize('kind', list(SPICE_SOURCE_SCHEMAS))
def test_all_source_unknown_properties_are_rejected_atomically(client, service, kind):
    project = service.create_project()
    response = command(client, project, 'add_component', {'id': 'source1', 'type': kind,
                                                         'properties': {'netlist': '.control\nshell bad'}})
    assert response.status_code == 400
    assert service.get_project(project['id']) == project
    command(client, project, 'add_component', {'id': 'source1', 'type': kind})
    before = service.get_project(project['id'])
    assert command(client, project, 'modify_component', {'id': 'source1', 'properties': {'unknown': 5}}).status_code == 400
    assert service.get_project(project['id']) == before


@pytest.mark.parametrize('kind,key,value', [
    ('source-dc-voltage', 'voltage', -12), ('source-dc-current', 'current', -0.02),
    ('source-sine-voltage', 'frequency', 20000), ('source-sine-voltage', 'phase', -90),
    ('source-pulse-voltage', 'high', 12), ('source-pwl-voltage', 'points', [[0, -1], [0.01, 2]]),
    ('source-ac-voltage', 'magnitude', 2),
])
def test_valid_source_properties_add_and_modify(client, service, kind, key, value):
    project = service.create_project()
    response = command(client, project, 'add_component', {'id': 'source1', 'type': kind, 'properties': {key: value}})
    assert response.status_code == 200
    assert response.json()['components'][-1]['properties'][key] == value
    assert command(client, project, 'modify_component', {'id': 'source1', 'properties': {key: value}}).status_code == 200


SCALAR_FIELDS = [(kind, key) for kind, (_, fields) in SPICE_SOURCE_SCHEMAS.items() for key, *_ in fields]


@pytest.mark.parametrize('kind,key', SCALAR_FIELDS)
@pytest.mark.parametrize('invalid', ['1k', '1\n.control', True, None, [], {'expression': '5'}])
def test_every_source_numeric_field_rejects_non_numbers(service, kind, key, invalid):
    project = service.create_project()
    with pytest.raises(HTTPException) as error:
        asyncio.run(service.command(project['id'], 'add_component',
                                    {'type': kind, 'properties': {key: invalid}}))
    assert error.value.status_code == 400
    assert service.get_project(project['id']) == project


@pytest.mark.parametrize('kind,key,minimum,maximum', [
    (kind, key, minimum, maximum)
    for kind, (_, fields) in SPICE_SOURCE_SCHEMAS.items()
    for key, _, minimum, maximum, _ in fields
])
def test_every_source_numeric_field_enforces_bounds(service, kind, key, minimum, maximum):
    for invalid in [minimum - max(1, abs(minimum)), maximum + 1, 10 ** 500, float('nan'), float('inf')]:
        project = service.create_project()
        with pytest.raises(HTTPException) as error:
            asyncio.run(service.command(project['id'], 'add_component', {'type': kind, 'properties': {key: invalid}}))
        assert error.value.status_code == 400
        assert service.get_project(project['id']) == project


@pytest.mark.parametrize('points', [[], [[0, 0]], '0 0 1m 5', [[0, 0], [0, 5]], [[1, 0], [0, 5]],
                                   [[-1, 0], [1, 5]], [[0, 0], [1000001, 0]], [[0, 0], [1, 1000001]],
                                   [[0, 0], ['1m', 5]], [[0, 0], [1, True]], [[0, 0], [1, 2, 3]],
                                   [[0, 0], {'time': 1, 'value': 2}], [[0, 0], [1, None]],
                                   [[i, 0] for i in range(257)]])
def test_invalid_pwl_points(client, service, points):
    project = service.create_project()
    response = command(client, project, 'add_component', {'type': 'source-pwl-voltage', 'properties': {'points': points}})
    assert response.status_code == 400
    assert service.get_project(project['id']) == project


def test_pulse_partial_edits_use_existing_values(client, service):
    project = service.create_project()
    assert command(client, project, 'add_component', {'id': 'pulse1', 'type': 'source-pulse-voltage',
                                                     'properties': {'period': 2, 'width': 1}}).status_code == 200
    assert command(client, project, 'modify_component', {'id': 'pulse1', 'properties': {'width': 1.5}}).status_code == 200
    before = service.get_project(project['id'])
    assert command(client, project, 'modify_component', {'id': 'pulse1', 'properties': {'period': 1}}).status_code == 400
    assert service.get_project(project['id']) == before
    assert command(client, project, 'add_component', {'type': 'source-pulse-voltage',
                                                     'properties': {'width': 2, 'period': 1}}).status_code == 400


@pytest.mark.parametrize('kind,value', [('resistor', '4.7k'), ('resistor', '1Meg'), ('resistor', '1e3'),
                                      ('capacitor', '10u'), ('capacitor', '1p'), ('inductor', '2.2m')])
def test_real_passive_string_values_and_pins(client, service, kind, value):
    project = service.create_project(board='arduino-uno')
    response = command(client, project, 'add_component', {'id': 'passive1', 'type': kind, 'properties': {'value': value}})
    assert response.status_code == 200
    entry = service.catalog.components[kind]
    assert entry['pins'] == ['1', '2']
    assert entry['properties'][0]['type'] == 'string'
    assert response.json()['components'][-1]['properties']['value'] == value
    for index, pin in enumerate(entry['pins']):
        assert command(client, project, 'connect_wire', {'from': {'component': 'passive1', 'pin': pin},
                                                       'to': {'component': 'board', 'pin': str(index)}}).status_code == 200


@pytest.mark.parametrize('kind', ['resistor', 'capacitor', 'inductor'])
@pytest.mark.parametrize('value', [1000, True, '0', '-1', '1e999', '1\n.control', '1k;quit', '1k ohm',
                                 '{1+1}', '1k\n.end', '1k shell', 'nan', ' 1k', '1e-99', '9' * 49])
def test_passive_values_reject_injection_and_invalid_ranges(client, service, kind, value):
    project = service.create_project()
    assert command(client, project, 'add_component', {'type': kind, 'properties': {'value': value}}).status_code == 400
    assert service.get_project(project['id']) == project


def test_spice_entries_always_exist_preserve_vendor_metadata_and_boards(tmp_path):
    for catalog in [ComponentCatalog(), ComponentCatalog(tmp_path / 'absent.json')]:
        assert set(BOARD_CONFIG).issubset(catalog.components)
        assert set(SPICE_SOURCE_SCHEMAS).issubset(catalog.components)
        for kind in ('resistor', 'capacitor', 'inductor'):
            assert catalog.components[kind]['properties'][0]['format'] == 'spice-value'
            assert catalog.components[kind]['defaultValues']['value']
    path = tmp_path / 'catalog.json'
    path.write_text(json.dumps({'components': [{'id': 'capacitor', 'name': 'Vendor capacitor',
                                               'tagName': 'velxio-capacitor', 'thumbnail': '<svg/>',
                                               'defaultValues': {'value': '2u'}}]}), encoding='utf-8')
    catalog = ComponentCatalog(path)
    assert catalog.components['capacitor']['name'] == 'Vendor capacitor'
    assert catalog.components['capacitor']['tagName'] == 'velxio-capacitor'
    assert catalog.components['capacitor']['thumbnail'] == '<svg/>'
    assert catalog.components['capacitor']['defaultValues'] == {'value': '2u'}
    assert 'velxio-capacitor' not in catalog.components
    result = catalog.search('source', 200)
    assert len([entry for entry in result['components'] if entry['id'] in SPICE_SOURCE_SCHEMAS]) == 6
    assert {board['id'] for board in result['boards']} == set(BOARD_CONFIG)


def test_no_fake_results_and_source_undo(client, service):
    project = service.create_project()
    response = command(client, project, 'add_component', {'type': 'source-dc-voltage'})
    assert response.status_code == 200
    assert response.json()['compiler'] is None
    assert 'results' not in response.json()
    assert command(client, project, 'undo', {}).json()['components'] == project['components']
