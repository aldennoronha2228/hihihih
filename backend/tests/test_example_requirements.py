import copy
import json

import pytest

from backend import example_requirements
from backend.example_requirements import (
    EXAMPLES_PATH, MAX_FILES, MAX_PARTS, MAX_SOURCE_CHARS, MAX_WIRES,
    get_example_reference, search_example_requirements,
)
from backend.hardware import service
from backend.sample_projects import example_source, normalize_template


@pytest.fixture
def actual_examples():
    return {example['id']: example for example in json.loads(EXAMPLES_PATH.read_text(encoding='utf-8'))}


def test_all_examples_are_available_as_requirement_references():
    result = search_example_requirements('OLED I2C', 3)
    assert result['total_examples'] == 321
    assert result['examples']
    assert any(example.get('dependencies') for example in result['examples'])
    assert 'not evidence' in result['verification']


@pytest.mark.parametrize('query,expected', [
    ('Please build an Arduino circuit with a blinking LED', 'blink-led'),
    ('Make an Arduino button control an LED', 'button-led'),
    ('Build an Arduino servo motor sweeping example', 'uno-servo'),
    ('Arduino DHT22 temperature humidity sensor', 'uno-dht22'),
])
def test_device_and_behavior_ranking_uses_real_examples(query, expected, actual_examples):
    result = search_example_requirements(query)
    first = result['examples'][0]
    assert first['id'] == expected
    raw = actual_examples[expected]
    assert first['source_available']
    assert first['source_preview'] == example_source(raw)[:1200]
    assert first['connection_count'] == len(raw.get('wires', []))
    assert first['board'] == 'arduino-uno'
    assert all('oled' not in item['id'] for item in result['examples'])


def test_tokenization_does_not_match_substrings_or_board_only_or_results():
    assert search_example_requirements('Arduino nonexistentdevice')['examples'] == []
    assert search_example_requirements('the please make')['examples'] == []
    assert search_example_requirements('OLEDness')['examples'] == []
    results = search_example_requirements('LED, button! Arduino')['examples']
    assert results[0]['id'] == 'button-led'
    assert all('button' in item['id'] for item in results)


def test_fully_supported_and_canonical_examples_are_preferred():
    result = search_example_requirements('blink LED')
    assert result['examples'][0]['fully_supported']
    servo = search_example_requirements('servo')['examples'][0]
    assert servo['id'] == 'uno-servo'
    assert servo['canonical_supported']
    assert not servo['fully_supported']
    assert servo['blockers']


def test_board_and_support_filters_preserve_original_call_signature():
    assert search_example_requirements('led', 1)['examples']
    nano = search_example_requirements('button LED', board='wokwi-arduino-nano', supported=True)
    assert [item['id'] for item in nano['examples']] == ['nano-button-led']
    assert nano['examples'][0]['board'] == 'arduino-nano'
    pico = search_example_requirements('button LED', board='raspberry-pi-pico')
    assert pico['examples'][0]['board'] == 'pi-pico'
    assert search_example_requirements('servo', supported=True)['examples'] == []
    assert all(not item['fully_supported'] for item in search_example_requirements('servo', supported=False)['examples'])


@pytest.mark.parametrize('example_id', ['blink-led', 'button-led', 'uno-servo', 'uno-dht22', 'uno-potentiometer'])
def test_reference_returns_actual_source_parts_wires_and_normalized_template(example_id, actual_examples):
    reference = get_example_reference(example_id, service.catalog)
    raw = actual_examples[example_id]
    assert reference['id'] == example_id
    assert reference['total_examples'] == 321
    assert reference['board'] == 'arduino-uno'
    assert reference['parts'] == raw.get('components', [])
    assert reference['wires'] == raw.get('wires', [])
    assert reference['source'] == example_source(raw)
    assert reference['connection_count'] == len(raw.get('wires', []))
    assert reference['libraries'] == raw.get('libraries', [])
    assert reference['normalized_template'] == normalize_template(raw, service.catalog, library_free=False)
    assert reference['normalization_error'] is None
    assert not reference['truncated']
    assert reference['verification_status']['real_compile'] == 'not_verified'
    assert reference['verification_status']['browser_run'] == 'not_verified'
    assert not reference['verification_status']['simulation_verified']


def test_reference_normalizes_actual_component_board_and_pin_aliases():
    reference = get_example_reference('uno-servo')
    template = reference['normalized_template']
    assert reference['parts'][0]['type'] == 'wokwi-servo'
    assert template['parts'][0]['type'] == 'servo'
    assert template['wires'][1]['from'] == {'component': 'board', 'pin': 'GND.1'}
    assert template['source'] == reference['source']
    assert reference['dependencies']['include_headers'] == ['Servo.h']
    assert any(item['category'] == 'dependency_unverified' for item in reference['limitations'])
    assert not reference['fully_supported']


def test_reference_uses_actual_board_code_when_top_level_code_is_empty(actual_examples):
    raw = actual_examples['uno-oled-4pin-i2c']
    reference = get_example_reference(raw['id'])
    assert raw['code'] == ''
    assert reference['source'] == raw['boards'][0]['code']
    assert reference['source_origin'] == 'boards[0].code'
    assert reference['board_sources'][0]['source'] == reference['source']
    assert reference['normalized_template']['source'] == raw['boards'][0]['code']
    assert reference['normalization_error'] is None
    assert reference['canonical_supported']
    assert reference['seedable']
    assert reference['simulation_ready']
    assert not reference['fully_supported']
    assert reference['dependencies']['declared_libraries'] == raw['libraries']


@pytest.mark.parametrize('example_id,category', [
    ('esp32-micropython-external-library', 'unsupported_language'),
    ('esp32-idf-blink', 'unsupported_language'),
    ('stm32-bluepill-blink', 'unsupported_board'),
])
def test_unsupported_references_still_return_real_source_and_limitations(example_id, category, actual_examples):
    raw = actual_examples[example_id]
    reference = get_example_reference(example_id)
    assert reference['source_available']
    assert reference['normalized_template'] is None
    assert reference['normalization_error']
    assert not reference['fully_supported']
    assert category in {item['category'] for item in reference['limitations']}
    if raw.get('files'):
        assert reference['files'] == [dict(entry, truncated=False) for entry in raw['files']]
        assert reference['source'] == raw['files'][0]['content']
        assert reference['source_origin'] == 'files[0].content'
    else:
        assert reference['source'] == example_source(raw)


@pytest.mark.parametrize('example_id,ready', [
    ('uno-oled-4pin-i2c', True), ('pico-oled-4pin-i2c', False),
    ('uno-dht22', True), ('rgb-led', True), ('uno-potentiometer', True),
])
def test_simulation_scope_uses_actual_board_and_preserves_dependencies(example_id, ready, actual_examples):
    reference = get_example_reference(example_id)
    assert reference['seedable']
    assert reference['simulation_ready'] is ready
    assert reference['simulation_scope'] == ('ready' if ready else 'partial')
    template = reference['normalized_template']
    assert template['source'] == example_source(actual_examples[example_id])
    assert template['libraries'] == actual_examples[example_id].get('libraries', [])


def test_truncated_libraries_never_return_an_incomplete_seed(monkeypatch, actual_examples):
    raw = copy.deepcopy(actual_examples['button-led'])
    raw['libraries'] = [f'Library {index}' for index in range(MAX_FILES + 1)]
    monkeypatch.setattr(example_requirements, '_load_examples', lambda: (
        {'source': 'actual-export', 'examples': [{'id': raw['id']}]}, {raw['id']: raw}))
    reference = get_example_reference(raw['id'])
    assert reference['truncation']['libraries']
    assert reference['normalized_template'] is None
    assert not reference['seedable']
    assert not reference['simulation_ready']


def test_catalog_board_support_is_recomputed_not_read_from_snapshot():
    catalog = copy.deepcopy(service.catalog)
    catalog.components['ssd1306-i2c-4pin']['simulation_boards'] = ['pi-pico']
    assert not get_example_reference('uno-oled-4pin-i2c', catalog)['simulation_ready']
    assert get_example_reference('pico-oled-4pin-i2c', catalog)['simulation_ready']
    catalog.components['ssd1306-i2c-4pin']['pins'] = []
    reference = get_example_reference('pico-oled-4pin-i2c', catalog)
    assert not reference['seedable']
    assert not reference['simulation_ready']
    assert reference['normalized_template'] is None


def test_all_321_actual_references_are_accessible_and_bounded(actual_examples, monkeypatch):
    data, examples = example_requirements._load_examples()
    monkeypatch.setattr(example_requirements, '_load_examples', lambda: (data, examples))
    for example_id, raw in actual_examples.items():
        reference = get_example_reference(example_id)
        assert reference['source_available'] == bool(any(
            content.strip() for _, content in example_requirements._source_entries(raw)))
        assert len(reference['source']) <= MAX_SOURCE_CHARS
        assert sum(len(entry['content']) for entry in reference['files']) <= MAX_SOURCE_CHARS
        assert len(reference['parts']) <= MAX_PARTS
        assert len(reference['wires']) <= MAX_WIRES
        assert reference['connection_count'] == len(raw.get('wires', []))
        assert reference['verification_status']['real_compile'] == 'not_verified'


def test_large_reference_is_explicitly_truncated_without_incomplete_template(monkeypatch, actual_examples):
    raw = copy.deepcopy(actual_examples['button-led'])
    raw['code'] = 'x' * (MAX_SOURCE_CHARS + 10)
    raw['components'] *= MAX_PARTS + 1
    raw['wires'] *= MAX_WIRES + 1
    raw['files'] = [{'name': f'file{index}.ino', 'content': raw['code']} for index in range(MAX_FILES + 1)]
    analysis = {'id': raw['id'], 'requirements': {'purpose': 'p' * 3000}}
    monkeypatch.setattr(example_requirements, '_load_examples', lambda: (
        {'source': 'actual-export', 'examples': [analysis]}, {raw['id']: raw}))
    reference = get_example_reference(raw['id'])
    assert reference['truncated']
    assert all(reference['truncation'][key] for key in ('analysis', 'source', 'parts', 'wires', 'files'))
    assert len(reference['source']) == MAX_SOURCE_CHARS
    assert len(reference['parts']) == MAX_PARTS
    assert len(reference['wires']) == MAX_WIRES
    assert len(reference['files']) == MAX_FILES
    assert sum(len(entry['content']) for entry in reference['files']) == MAX_SOURCE_CHARS
    assert reference['normalized_template'] is None
    assert 'truncated' in reference['normalization_error']


@pytest.mark.parametrize('query,limit', [('', 3), ('x' * 201, 3), (None, 3), ('led', 50), ('led', True)])
def test_requirement_query_is_bounded(query, limit):
    with pytest.raises(ValueError):
        search_example_requirements(query, limit)


@pytest.mark.parametrize('kwargs', [{'board': ''}, {'board': 5}, {'board': 'x' * 81}, {'supported': 'yes'}])
def test_filters_are_validated(kwargs):
    with pytest.raises(ValueError):
        search_example_requirements('led', **kwargs)


@pytest.mark.parametrize('example_id', ['', '../button-led', None, 'unknown-example'])
def test_reference_id_is_validated(example_id):
    with pytest.raises(ValueError):
        get_example_reference(example_id)
