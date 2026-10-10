import asyncio
import copy
import hashlib
import json
import math

import pytest
from fastapi import HTTPException

from backend.feasibility import assess
from backend.hardware import (
    BOARD_ALIASES, BOARD_CONFIG, COMPONENT_PINS, EXPLICIT_PIN_LAYOUTS,
    PIN_ALIASES, PIN_LAYOUTS, ROOT, ComponentCatalog, HardwareService,
    load_component_pins,
)


DATA = json.loads((ROOT / 'backend/catalog/component-pins.json').read_text(encoding='utf-8'))
SOURCE = json.loads((ROOT / DATA['provenance']['catalog']).read_text(encoding='utf-8'))['components']


def test_catalog_schema_and_provenance():
    assert DATA['schema_version'] == 1
    assert len(SOURCE) == len(DATA['components']) == DATA['counts']['catalog'] == 157
    assert set(DATA['components']) == {part['id'] for part in SOURCE}
    for key in ('catalog', 'registration'):
        assert hashlib.sha256((ROOT / DATA['provenance'][key]).read_bytes()).hexdigest() == DATA['provenance'][key + 'Sha256']
    assert DATA['provenance']['browser'].startswith('Chromium ')
    records = list(DATA['components'].values())
    counts = DATA['counts']
    assert counts['defined'] == sum(record['defined'] for record in records)
    assert counts['verified'] == sum(record['status'] == 'verified' for record in records)
    assert counts['noPins'] == sum(record['status'] == 'no-pins' for record in records)
    assert counts['missingTags'] == sum(record['status'] == 'missing-tag' for record in records)
    assert counts['extractionErrors'] == sum(record['status'] == 'extraction-error' for record in records)
    assert counts['pins'] == sum(len(record['pins']) for record in records)
    assert {failure['id'] for failure in DATA['failures']} == {kind for kind, record in DATA['components'].items() if record.get('error')}


@pytest.mark.parametrize('source', SOURCE, ids=lambda source: source['id'])
def test_every_selected_entry_is_observed_without_fabricated_pins(source):
    record = DATA['components'][source['id']]
    assert record['tagName'] == source['tagName']
    assert record['defaultValues'] == source.get('defaultValues', {})
    assert type(record['defined']) is bool
    assert record['status'] in ('verified', 'no-pins', 'missing-tag', 'extraction-error')
    assert record['pinCount'] == len(record['pins'])
    if record['status'] == 'verified':
        assert record['defined'] and record['pinInfoDefined'] and record['pins']
        for pin in record['pins']:
            assert isinstance(pin['name'], str) and pin['name']
            assert all(type(pin[axis]) in (int, float) and math.isfinite(pin[axis]) for axis in ('x', 'y'))
            assert set(pin) <= {'name', 'x', 'y', 'label'}
    else:
        assert record['pins'] == []
        if record['status'] in ('missing-tag', 'extraction-error'):
            assert record['error']
        if record['status'] == 'missing-tag':
            assert not record['defined']


def test_verified_layouts_fill_only_missing_explicit_layouts():
    catalog = ComponentCatalog()
    for kind, record in COMPONENT_PINS.items():
        if kind in BOARD_ALIASES:
            continue
        entry = catalog.components[kind]
        assert entry['pinInfo'] == record['pins']
        assert entry['pin_provenance'] == 'backend/catalog/component-pins.json'
        if kind not in EXPLICIT_PIN_LAYOUTS:
            assert entry['pins'] == [pin['name'] for pin in record['pins']]
            assert entry['pinCount'] == len(entry['pins'])
            assert entry['connectable']
    assert catalog.components['led']['pins'] == ['A', 'C']
    for kind in BOARD_CONFIG:
        assert catalog.components[kind]['pins'] == PIN_LAYOUTS[kind]
        assert catalog.components[kind]['pin_aliases'] == PIN_ALIASES.get(kind, {})


def test_io_modes_use_actual_element_defaults():
    catalog = ComponentCatalog()
    assert catalog.components['lcd1602']['defaultValues']['pins'] == 'full'
    assert catalog.components['lcd2004']['defaultValues']['pins'] == 'full'
    assert catalog.components['lcd1602-i2c']['defaultValues']['pins'] == 'i2c'
    assert catalog.components['lcd2004-i2c']['defaultValues']['pins'] == 'i2c'
    assert catalog.components['lcd1602-i2c']['pins'] == ['GND', 'VCC', 'SDA', 'SCL']
    assert catalog.components['lcd1602']['pins'] == ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']
    assert catalog.components['7segment']['pinCount'] == 10


def test_wireless_remote_has_no_fabricated_physical_pins():
    record = DATA['components']['ir-remote']
    assert record['defined'] and record['status'] == 'no-pins'
    assert not record['pinInfoDefined']
    entry = ComponentCatalog().components['ir-remote']
    assert entry['pins'] == [] and not entry['connectable']
    assert 'ir-remote' not in COMPONENT_PINS


def test_loader_rejects_missing_tags_bad_counts_and_unsafe_pin_info(tmp_path):
    valid = copy.deepcopy(DATA['components']['diode'])
    records = {'valid': valid}
    for name, patch in (
        ('missing-tag', {'defined': False}),
        ('failed', {'status': 'extraction-error'}),
        ('count', {'pinCount': 20}),
        ('empty', {'pins': [], 'pinCount': 0}),
        ('duplicate', {'pins': [valid['pins'][0], valid['pins'][0]]}),
        ('invalid-coordinate', {'pins': [{'name': 'A', 'x': '0', 'y': 0}, valid['pins'][1]]}),
    ):
        records[name] = {**copy.deepcopy(valid), **patch}
    path = tmp_path / 'pins.json'
    path.write_text(json.dumps({'schema_version': 1, 'components': records}), encoding='utf-8')
    assert set(load_component_pins(path)) == {'valid'}
    assert load_component_pins(tmp_path / 'missing.json') == {}
    path.write_text(json.dumps({'schema_version': 2, 'components': records}), encoding='utf-8')
    with pytest.raises(ValueError, match='schema'):
        load_component_pins(path)


def test_other_catalog_tag_cannot_borrow_verified_layout(tmp_path):
    path = tmp_path / 'metadata.json'
    path.write_text(json.dumps({'components': [{
        'id': 'diode', 'tagName': 'undefined-diode', 'pinCount': 999,
        'category': 'other', 'defaultValues': {}, 'properties': [],
    }]}), encoding='utf-8')
    entry = ComponentCatalog(path).components['diode']
    assert not entry['pins'] and not entry['connectable']
    assert 'pinInfo' not in entry


def test_all_mapped_nonboard_parts_can_be_built_and_wired(tmp_path):
    service = HardwareService(tmp_path)
    for kind, record in COMPONENT_PINS.items():
        entry = service.catalog.components.get(kind)
        if not entry or entry.get('category') == 'boards':
            continue
        project = service.create_project(kind, 'arduino-uno')
        report = assess(service, project['id'], {'parts': [{'type': kind}], 'operations': ['add_component', 'connect_wire']})
        assert report['status'] == 'approved', kind
        asyncio.run(service.command(project['id'], 'add_component', {'type': kind, 'id': 'part'}))
        wired = asyncio.run(service.command(project['id'], 'connect_wire', {
            'from': {'component': 'board', 'pin': 'GND'},
            'to': {'component': 'part', 'pin': entry['pins'][0]},
        }))
        assert wired['wires'][0]['from']['pin'] == 'GND.1'
        with pytest.raises(HTTPException, match='Unknown component pin'):
            asyncio.run(service.command(project['id'], 'connect_wire', {
                'from': {'component': 'board', 'pin': '13'},
                'to': {'component': 'part', 'pin': 'invented-pin'},
            }))
    diode = service.catalog.components['diode']
    assert not diode.get('simulation_boards')
    assert any(notice['code'] == 'diode_runtime' for notice in assess(
        service, service.create_project('Physical build', 'arduino-uno')['id'],
        {'parts': [{'type': 'diode'}], 'operations': ['add_component']},
    )['notices'])
