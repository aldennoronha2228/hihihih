import asyncio
import copy
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from backend.circuit_wiring import validate_circuit, wire_circuit
from backend.hardware import HardwareService, RuntimeBridge


@pytest.fixture
def service(tmp_path):
    return HardwareService(tmp_path / 'projects', runtime=RuntimeBridge(timeout=0.2))


def run(awaitable):
    return asyncio.run(awaitable)


def wire(start_component, start_pin, end_component, end_pin, **metadata):
    return {'from': {'component': start_component, 'pin': start_pin},
            'to': {'component': end_component, 'pin': end_pin}, **metadata}


def led_project(service):
    project = service.create_project(board='arduino-uno')
    for component in ({'id': 'led1', 'type': 'led'},
                      {'id': 'r1', 'type': 'resistor', 'properties': {'value': '220'}}):
        project = run(service.command(project['id'], 'add_component', component))
    return project


def led_batch(resistor_on_ground=False):
    if resistor_on_ground:
        return [wire('board', '13', 'led1', 'A'), wire('led1', 'C', 'r1', '1'),
                wire('r1', '2', 'board', 'GND')]
    return [wire('board', 'D13', 'r1', '1'), wire('r1', '2', 'led1', 'A'),
            wire('led1', 'C', 'board', 'GND')]


@pytest.mark.parametrize('pins', [('5V', 'GND'), ('3.3V', 'GND'), ('5V', '3.3V')])
def test_power_short_rolls_back(service, pins):
    project = service.create_project(board='arduino-uno')
    original = service._path(project['id']).read_bytes()
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': [wire('board', pins[0], 'board', pins[1])]}))
    assert error.value.status_code == 400
    report = error.value.detail['validation']
    short = next(item for item in report['errors'] if item['code'] == 'power_short')
    assert len(short['evidence']['rails']) == 2
    assert len(short['evidence']['endpoints']) >= 2
    assert len(short['evidence']['wire_ids']) == 1
    assert service._path(project['id']).read_bytes() == original


def test_transitive_short_across_implicit_ground_pins(service):
    project = led_project(service)
    run(service.command(project['id'], 'connect_wire', wire('board', '3.3V', 'r1', '1')))
    original = service._path(project['id']).read_bytes()
    batch = [wire('r1', '1', 'board', 'GND.2'), wire('board', 'GND.3', 'board', '5V')]
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': batch}))
    short = next(item for item in error.value.detail['validation']['errors'] if item['code'] == 'power_short')
    assert short['evidence']['rails'] == ['3.3V', '5V', 'GND']
    assert len(short['evidence']['wire_ids']) == 3
    assert service._path(project['id']).read_bytes() == original


@pytest.mark.parametrize('board,power,ground', [('pi-pico', '3V3', 'GND.8'),
                                             ('esp32-c3', '3V3.2', 'GND.10'),
                                             ('arduino-nano', '5V.2', 'GND.3')])
def test_known_board_rail_names(service, board, power, ground):
    project = service.create_project(board=board)
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': [wire('board', power, 'board', ground)]}))
    assert error.value.detail['validation']['errors'][0]['code'] == 'power_short'


def test_invalid_last_endpoint_has_no_partial_writes(service, monkeypatch):
    project = led_project(service)
    original = service._path(project['id']).read_bytes()
    batch = led_batch()
    batch[-1]['to']['pin'] = 'not-a-pin'
    saves = []
    monkeypatch.setattr(service, '_save', lambda candidate: saves.append(candidate))
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': batch}))
    assert error.value.status_code == 400
    assert saves == []
    assert service._path(project['id']).read_bytes() == original


@pytest.mark.parametrize('ground_side', [False, True])
def test_led_220_series_one_save_revision_history_and_undo(service, monkeypatch, ground_side):
    project = led_project(service)
    with service.lock:
        stored = service._load(project['id'])
        stored['compiler'] = {'stale': False}
        service._save(stored)
    original = copy.deepcopy(stored)
    saves = []
    save = service._save

    def tracked_save(candidate):
        saves.append(copy.deepcopy(candidate))
        save(candidate)

    monkeypatch.setattr(service, '_save', tracked_save)
    result = run(wire_circuit(service, project['id'],
                             {'batch': led_batch(ground_side), 'expected_revision': project['revision']}))
    changed = result['project']
    assert result['changed'] and len(result['added']) == 3 and result['existing'] == []
    assert len(saves) == 1
    assert changed['revision'] == project['revision'] + 1
    assert result['validation']['revision'] == changed['revision']
    assert changed['history'][:-1] == project['history']
    assert changed['history'][-1]['operation'] == 'wire_circuit'
    assert len(saves[0]['_undo']) == len(original['_undo']) + 1
    assert changed['compiler']['stale']
    assert changed['firmware'] == project['firmware']
    assert '_undo' not in changed and '_artifacts' not in changed
    report = run(validate_circuit(service, project['id']))
    assert report['valid'] and report['errors'] == [] and report['warnings'] == []
    anode_net = next(net for net in report['nets'] if {'component': 'led1', 'pin': 'A'} in net['endpoints'])
    cathode_net = next(net for net in report['nets'] if {'component': 'led1', 'pin': 'C'} in net['endpoints'])
    assert anode_net['id'] != cathode_net['id']
    restored = run(service.command(project['id'], 'undo'))
    assert restored['revision'] == changed['revision'] + 1
    for key in ('name', 'board', 'components', 'wires', 'firmware'):
        assert restored[key] == project[key]


def test_idempotence_aliases_and_reversed_connection(service):
    project = led_project(service)
    batch = led_batch()
    result = run(wire_circuit(service, project['id'], {'batch': batch}))
    original = service._path(project['id']).read_bytes()
    replay = run(wire_circuit(service, project['id'], {'batch': batch}))
    assert not replay['changed'] and replay['added'] == []
    assert replay['existing'] == result['added']
    reversed_batch = [{'from': item['to'], 'to': item['from']} for item in result['wires']]
    assert not run(wire_circuit(service, project['id'], {'batch': reversed_batch}))['changed']
    assert service._path(project['id']).read_bytes() == original
    conflicting = copy.deepcopy(batch)
    conflicting[0]['color'] = 'red'
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': conflicting}))
    assert error.value.status_code == 409
    assert service._path(project['id']).read_bytes() == original


@pytest.mark.parametrize('batch', [
    [wire('board', 'D13', 'board', '13')],
    [wire('board', '13', 'board', '12'), wire('board', '12', 'board', 'D13')],
    [wire('board', '13', 'board', '12', id='same'), wire('board', '11', 'board', '10', id='same')],
    [wire('board', '13', 'board', '12', color='invalid!')],
    [wire('board', '13', 'board', '12', id='../bad')],
    [wire('missing', '1', 'board', '12')],
])
def test_bad_batch_rolls_back(service, batch):
    project = service.create_project(board='arduino-uno')
    original = service._path(project['id']).read_bytes()
    with pytest.raises(HTTPException):
        run(wire_circuit(service, project['id'], {'batch': batch}))
    assert service._path(project['id']).read_bytes() == original


def test_revision_conflict_and_concurrent_batches(service):
    project = service.create_project(board='arduino-uno')
    args = {'batch': [wire('board', '13', 'board', '12')], 'expected_revision': project['revision']}

    def apply():
        try:
            return run(wire_circuit(service, project['id'], args))
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: apply(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 409 in results
    changed = service.get_project(project['id'])
    assert changed['revision'] == project['revision'] + 1 and len(changed['wires']) == 1


@pytest.mark.parametrize('power,is_error', [('5V', True), ('3.3V', True), ('13', False)])
def test_direct_led_missing_resistor(service, power, is_error):
    project = led_project(service)
    batch = [wire('board', power, 'led1', 'A'), wire('led1', 'C', 'board', 'GND')]
    if is_error:
        original = service._path(project['id']).read_bytes()
        with pytest.raises(HTTPException) as error:
            run(wire_circuit(service, project['id'], {'batch': batch}))
        report = error.value.detail['validation']
        assert service._path(project['id']).read_bytes() == original
    else:
        report = run(wire_circuit(service, project['id'], {'batch': batch}))['validation']
        assert report['valid']
    findings = report['errors'] if is_error else report['warnings']
    assert findings[0]['code'] == 'led_missing_series_resistor'
    assert findings[0]['evidence']['component_id'] == 'led1'
    assert findings[0]['evidence']['wire_ids']


def test_validation_current_project_read_only_and_full_candidate(service):
    project = service.create_project(board='arduino-uno')
    run(service.command(project['id'], 'connect_wire', wire('board', '5V', 'board', 'GND')))
    original = service._path(project['id']).read_bytes()
    report = run(validate_circuit(service, project['id']))
    assert not report['valid'] and report['errors'][0]['code'] == 'power_short'
    assert report['revision'] == service.get_project(project['id'])['revision']
    assert 'general electrical correctness are not verified' in report['scope']
    assert service._path(project['id']).read_bytes() == original
    with pytest.raises(HTTPException):
        run(wire_circuit(service, project['id'], {'batch': [wire('board', '13', 'board', '12')]}))
    assert service._path(project['id']).read_bytes() == original


@pytest.mark.parametrize('points', [[{'x': True, 'y': 0}], [{'x': float('inf'), 'y': 0}],
                                   [{'x': 1000001, 'y': 0}], [{'x': 0}], [[0, 1]],
                                   [{'x': 0, 'y': 0}] * 65])
def test_invalid_waypoints_rollback(service, points):
    project = service.create_project(board='arduino-uno')
    original = service._path(project['id']).read_bytes()
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'],
                         {'batch': [wire('board', '13', 'board', '12', waypoints=points)]}))
    assert error.value.status_code == 400
    assert service._path(project['id']).read_bytes() == original


def test_waypoints_and_connected_runtime_match_ordinary_mutations(service):
    project = service.create_project(board='arduino-uno')
    service.runtime.sessions[project['id']] = object()
    points = [{'x': 10, 'y': -20.5}]
    result = run(wire_circuit(service, project['id'],
                             {'batch': [wire('board', '13', 'board', '12', waypoints=points)]}))
    assert result['wires'][0]['waypoints'] == points
    assert result['project']['wires'][0]['from'] == {'component': 'board', 'pin': '13'}


def test_ground_symbol_and_resistor_do_not_merge_power_nets(service):
    project = service.create_project(board='arduino-uno')
    for item in ({'id': 'g', 'type': 'ground'}, {'id': 'r', 'type': 'resistor', 'properties': {'value': '220'}}):
        run(service.command(project['id'], 'add_component', item))
    result = run(wire_circuit(service, project['id'], {'batch': [wire('board', '5V', 'r', '1'),
                                                               wire('r', '2', 'g', 'GND')]}))
    assert result['validation']['valid'] and result['validation']['errors'] == []
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': [wire('r', '1', 'r', '2')]}))
    assert error.value.detail['validation']['errors'][0]['code'] == 'power_short'


@pytest.mark.parametrize('args', [None, [], {}, {'batch': []}, {'batch': [None]},
                                  {'batch': [], 'unknown': True},
                                  {'batch': [wire('board', '13', 'board', '12')], 'expected_revision': True}])
def test_invalid_argument_contract(service, args):
    project = service.create_project(board='arduino-uno')
    original = service._path(project['id']).read_bytes()
    with pytest.raises(HTTPException):
        run(wire_circuit(service, project['id'], args))
    assert service._path(project['id']).read_bytes() == original


def test_read_validation_reports_invalid_and_duplicate_existing_wires(service):
    project = service.create_project(board='arduino-uno')
    with service.lock:
        stored = service._load(project['id'])
        stored['wires'] = [wire('board', '13', 'board', '12', id='one'),
                           wire('board', '12', 'board', 'D13', id='two'),
                           wire('board', '13', 'board', '13', id='self'),
                           wire('board', 'bad', 'board', '12', id='invalid')]
        service._save(stored)
    original = service._path(project['id']).read_bytes()
    report = run(validate_circuit(service, project['id']))
    assert not report['valid']
    codes = {item['code'] for item in report['errors']}
    assert codes == {'invalid_wire', 'self_wire', 'duplicate_connection'}
    assert service._path(project['id']).read_bytes() == original


def test_led_resistor_bypass_is_not_a_series_resistor(service):
    project = led_project(service)
    result = run(wire_circuit(service, project['id'], {'batch': led_batch()}))
    result = run(wire_circuit(service, project['id'], {'batch': [wire('r1', '1', 'r1', '2')]}))
    assert result['validation']['valid']
    assert result['validation']['warnings'][0]['code'] == 'led_missing_series_resistor'


def test_unknown_led_topology_is_warning_not_safety_claim(service):
    project = led_project(service)
    report = run(validate_circuit(service, project['id']))
    assert report['valid'] and report['errors'] == []
    assert report['warnings'][0]['code'] == 'led_topology_unverified'


def test_wire_limit_allows_replay_but_not_additions(service):
    project = service.create_project(board='arduino-mega')
    with service.lock:
        stored = service._load(project['id'])
        stored['wires'] = [wire('board', str(left), 'board', str(right), id=f'w{left}_{right}')
                           for left in range(54) for right in range(left + 1, 54)][:500]
        service._save(stored)
    original = service._path(project['id']).read_bytes()
    first = stored['wires'][0]
    assert not run(wire_circuit(service, project['id'], {'batch': [first]}))['changed']
    with pytest.raises(HTTPException) as error:
        run(wire_circuit(service, project['id'], {'batch': [wire('board', '52', 'board', '53')]}))
    assert error.value.status_code == 400
    assert service._path(project['id']).read_bytes() == original
