import copy
import hashlib
import json
import re
from pathlib import Path

from fastapi import HTTPException

from backend.hardware import BOARD_ALIASES, service
from backend.sample_projects import example_boards, normalize_template

ANALYSIS_PATH = Path(__file__).resolve().parent / 'templates/example-analysis.json'
EXAMPLES_PATH = ANALYSIS_PATH.with_name('velxio-examples.json')
MAX_SOURCE_CHARS = 30000
MAX_PARTS = 64
MAX_WIRES = 128
MAX_FILES = 16
SOURCE_PREVIEW_CHARS = 1200
VERIFICATION = 'Static source and canonical-service analysis; not evidence that these examples compile or simulate.'
STOPWORDS = set('a an and are as at be build by can circuit code create demo example for from how i in is it make me of on project show sketch that the this to use using want with when which please then turns turn'.split())
BOARD_WORDS = set('arduino uno nano mega atmega328p atmega2560 board boards raspberry pi pico esp32 esp32s3 esp32c3 devkit v1 v4 stm32 attiny85 w'.split())
ALIASES = {
    'leds': 'led', 'buttons': 'button', 'pushbutton': 'button',
    'blinking': 'blink', 'blinks': 'blink', 'sweeping': 'sweep',
    'sweeps': 'sweep', 'sensors': 'sensor', 'servos': 'servo',
    'pressed': 'press', 'pressing': 'press', 'controlled': 'control',
    'controls': 'control', 'controlling': 'control',
    'hcsr04': 'ultrasonic',
}
DEVICE_WORDS = set('led button servo sensor potentiometer oled ssd1306 dht22 dht11 ultrasonic buzzer neopixel rgb ldr joystick lcd relay encoder stepper'.split())
ANALYSIS_KEYS = (
    'id', 'title', 'category', 'difficulty', 'boards', 'components', 'language',
    'dependencies', 'blockers', 'classification', 'canonical_validation',
    'payload_features', 'requirements', 'verification', 'provenance', 'adaptations',
)


def _load_examples():
    data = json.loads(ANALYSIS_PATH.read_text(encoding='utf-8'))
    raw = json.loads(EXAMPLES_PATH.read_text(encoding='utf-8'))
    return data, {example['id']: example for example in raw}


def _tokens(text):
    words = re.findall(r'[a-z0-9]+', text.lower())
    tokens = {ALIASES.get(word, word) for word in words}
    if 'hc' in tokens and 'sr04' in tokens:
        tokens.add('ultrasonic')
    return tokens


def _bound(value, truncated, list_limit=MAX_WIRES):
    if isinstance(value, str):
        truncated[0] |= len(value) > 2000
        return value[:2000]
    if isinstance(value, list):
        truncated[0] |= len(value) > list_limit
        return [_bound(item, truncated, list_limit) for item in value[:list_limit]]
    if isinstance(value, dict):
        truncated[0] |= len(value) > 64
        return {key: _bound(item, truncated, list_limit) for key, item in list(value.items())[:64]}
    return copy.deepcopy(value)


def _analysis_fields(example):
    truncated = [False]
    fields = {key: _bound(example[key], truncated) for key in ANALYSIS_KEYS if key in example}
    return fields, truncated[0]


def _source_entries(example):
    if example.get('files'):
        return [(f'files[{index}].content', entry.get('content', ''))
                for index, entry in enumerate(example['files'])]
    boards = example.get('boards', [])
    if any('code' in board for board in boards):
        return [(f'boards[{index}].code', board.get('code', ''))
                for index, board in enumerate(boards) if 'code' in board]
    return [('code', example.get('code', ''))]


def _support(example):
    canonical = example.get('verification', {}).get('canonical_service') == 'passed'
    return canonical, canonical and not example.get('blockers')


def get_example_reference(example_id, catalog=None):
    if not isinstance(example_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', example_id):
        raise ValueError('Invalid example identifier.')
    data, examples = _load_examples()
    if example_id not in examples:
        raise ValueError('Unknown example identifier.')
    raw = examples[example_id]
    analysis = next((item for item in data['examples'] if item['id'] == example_id), {})
    catalog = service.catalog if catalog is None else catalog
    result, analysis_truncated = _analysis_fields(analysis)
    entries = _source_entries(raw)
    origin, source = entries[0]
    truncation = {
        'analysis': analysis_truncated, 'source': len(source) > MAX_SOURCE_CHARS,
        'parts': len(raw.get('components', [])) > MAX_PARTS,
        'wires': len(raw.get('wires', [])) > MAX_WIRES,
        'files': len(raw.get('files', [])) > MAX_FILES,
        'board_sources': len(entries) > MAX_FILES,
    }
    bounded = [False]
    parts = _bound(raw.get('components', [])[:MAX_PARTS], bounded)
    wires = _bound(raw.get('wires', [])[:MAX_WIRES], bounded)
    files = []
    remaining = MAX_SOURCE_CHARS
    for entry in raw.get('files', [])[:MAX_FILES]:
        content = entry.get('content', '')
        metadata = _bound({key: value for key, value in entry.items() if key != 'content'}, bounded)
        metadata.update(content=content[:remaining], truncated=len(content) > remaining)
        truncation['files'] |= metadata['truncated']
        remaining -= len(metadata['content'])
        files.append(metadata)
    board_sources = []
    remaining = MAX_SOURCE_CHARS
    for location, content in entries[:MAX_FILES]:
        if not location.startswith('boards['):
            continue
        board_sources.append({'origin': location, 'source': content[:remaining],
                              'truncated': len(content) > remaining})
        truncation['board_sources'] |= len(content) > remaining
        remaining -= len(board_sources[-1]['source'])
    truncation['metadata'] = bounded[0]
    boards = example_boards(raw, catalog)
    canonical, fully_supported = _support(analysis)
    limitations = copy.deepcopy(result.get('blockers', []))
    normalized = None
    normalization_error = None
    if any(truncation.values()):
        normalization_error = 'Reference was truncated; a complete normalized template is not returned.'
    else:
        try:
            normalized = normalize_template(raw, catalog, library_free=False)
        except (ValueError, KeyError, TypeError, HTTPException) as exc:
            normalization_error = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
    if normalization_error:
        limitations.append({'category': 'normalization_unavailable', 'detail': normalization_error[:2000]})
    libraries_truncated = [False]
    libraries = _bound(raw.get('libraries', []), libraries_truncated, MAX_FILES)
    truncation['libraries'] = libraries_truncated[0]
    result.update({
        'id': raw['id'], 'title': raw['title'], 'description': raw.get('description', '')[:2000],
        'reference_source': data['source'], 'total_examples': len(examples),
        'boards': boards[:MAX_FILES], 'board': boards[0] if len(boards) == 1 else None,
        'parts': parts, 'wires': wires, 'part_count': len(raw.get('components', [])),
        'connection_count': len(raw.get('wires', [])),
        'source': source[:MAX_SOURCE_CHARS], 'source_origin': origin,
        'source_available': any(content.strip() for _, content in entries),
        'source_char_count': sum(len(content) for _, content in entries),
        'files': files, 'file_count': len(raw.get('files', [])), 'board_sources': board_sources,
        'libraries': libraries, 'limitations': limitations,
        'canonical_supported': canonical, 'fully_supported': fully_supported,
        'normalized_template': normalized, 'normalization_error': normalization_error,
        'verification': VERIFICATION,
        'verification_status': {**analysis.get('verification', {}), 'real_compile': 'not_verified',
                                'browser_run': 'not_verified', 'simulation_verified': False},
        'truncated': any(truncation.values()), 'truncation': truncation,
    })
    knowledge_path = ANALYSIS_PATH.with_name('example-build-knowledge.json')
    if knowledge_path.exists():
        knowledge = json.loads(knowledge_path.read_text(encoding='utf-8'))
        if knowledge.get('export_sha256') == hashlib.sha256(EXAMPLES_PATH.read_bytes()).hexdigest():
            record = next((item for item in knowledge['examples'] if item['id'] == example_id), None)
            if record:
                result['build_knowledge'] = {key: record[key] for key in ('source_facts', 'adaptations', 'canonical_mapping_available', 'source_sha256')}
    return result


def search_example_requirements(query: str, limit: int = 5, board=None, supported=None):
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200:
        raise ValueError('Search query must contain 1 to 200 characters.')
    if type(limit) is not int or not 1 <= limit <= 8:
        raise ValueError('Search limit must be between 1 and 8.')
    if board is not None and (not isinstance(board, str) or not board.strip() or len(board) > 80):
        raise ValueError('Board must be a nonempty board identifier of at most 80 characters.')
    if supported is not None and type(supported) is not bool:
        raise ValueError('Supported must be a boolean.')
    board = BOARD_ALIASES.get(board.removeprefix('wokwi-'), board.removeprefix('wokwi-')) if board else None
    data, examples = _load_examples()
    words = _tokens(query) - STOPWORDS
    focus = words - BOARD_WORDS
    devices = focus & DEVICE_WORDS
    matches = []
    for analysis in data['examples']:
        raw = examples.get(analysis['id'])
        if raw is None:
            continue
        boards = example_boards(raw, service.catalog)
        canonical, fully_supported = _support(analysis)
        if board is not None and board not in boards:
            continue
        if supported is not None and fully_supported != supported:
            continue
        title = _tokens(raw['id'] + ' ' + raw['title']) - BOARD_WORDS
        parts = _tokens(' '.join(part['type'] for part in raw.get('components', [])))
        description = _tokens(raw.get('description', '') + ' ' + raw.get('category', '') + ' ' + ' '.join(raw.get('tags', [])))
        identity = title | parts | description
        if identity & {'dht22', 'dht11', 'ultrasonic', 'ldr', 'temperature', 'humidity'}:
            identity.add('sensor')
        # Board words cannot rescue an example that misses the requested device.
        if devices and not devices <= identity:
            continue
        hits = focus & identity
        board_hits = words & _tokens(' '.join(boards))
        if (focus and not hits) or (not focus and not board_hits):
            continue
        behavior_hits = focus & {'blink','sweep','distance','press','control','temperature','humidity','counter'}
        score = (len(behavior_hits & identity), len(hits & title), len(hits), fully_supported, canonical,
                 len(board_hits), -len(analysis.get('blockers', [])), len(hits & parts),
                 boards == ['arduino-uno'], -len(raw.get('components', [])))
        matches.append((score, analysis, raw, boards))
    matches.sort(key=lambda item: (tuple(-value for value in item[0]), item[1]['id']))
    results = []
    for _, analysis, raw, boards in matches[:limit]:
        result, truncated = _analysis_fields(analysis)
        entries = _source_entries(raw)
        origin, source = next(((origin, content) for origin, content in entries if content.strip()), entries[0])
        canonical, fully_supported = _support(analysis)
        result.update({
            'boards': boards, 'board': boards[0] if len(boards) == 1 else None,
            'description': raw.get('description', '')[:2000],
            'part_count': len(raw.get('components', [])), 'connection_count': len(raw.get('wires', [])),
            'source_available': any(content.strip() for _, content in entries),
            'source_preview': source[:SOURCE_PREVIEW_CHARS], 'source_origin': origin,
            'source_preview_truncated': len(source) > SOURCE_PREVIEW_CHARS,
            'canonical_supported': canonical, 'fully_supported': fully_supported, 'truncated': truncated,
        })
        results.append(result)
    return {'source': data['source'], 'total_examples': len(examples),
            'verification': VERIFICATION, 'examples': results}
