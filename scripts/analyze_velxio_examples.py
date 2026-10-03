import argparse
import asyncio
import hashlib
import json
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi import HTTPException

from backend.hardware import BOARD_CONFIG, HardwareService
from backend.sample_projects import (
    EXAMPLES_PATH, STARTER_IDS, UPSTREAM_PATH, create_copy, example_boards,
    example_source, normalize_template, normalize_type,
)


async def analyze(path=EXAMPLES_PATH):
    raw = Path(path).read_bytes()
    examples = json.loads(raw)
    records = []
    with tempfile.TemporaryDirectory(prefix='wireup-example-analysis-') as directory:
        service = HardwareService(directory)
        catalog = service.catalog
        for example in examples:
            boards = example_boards(example, catalog)
            language = example.get('languageMode', 'arduino')
            files = example.get('files', [])
            sources = [file.get('content', '') for file in files] if files else [example.get('code', '')]
            sources.extend(board.get('code', '') for board in example.get('boards', []))
            combined = '\n'.join(sources)
            headers = sorted(set(re.findall(r'^\s*#\s*include\s*[<\"]([^>\"\n]+)', combined, re.MULTILINE)))
            imports = sorted(set(re.findall(r'^\s*(?:from|import)\s+([\w.]+)', combined, re.MULTILINE)))
            blockers = []
            unsupported_boards = [board for board in boards if board not in BOARD_CONFIG]
            if unsupported_boards:
                blockers.append({'category': 'unsupported_board', 'detail': unsupported_boards})
            if len(boards) != 1 or len(example.get('boards', [])) > 1:
                blockers.append({'category': 'multi_board', 'detail': 'Service supports one board and one firmware source.'})
            if language != 'arduino':
                blockers.append({'category': 'unsupported_language', 'detail': language})
            if len(files) > 1:
                blockers.append({'category': 'multi_file', 'detail': [file['name'] for file in files]})
            elif files and not files[0]['name'].endswith('.ino'):
                blockers.append({'category': 'unsupported_source_file', 'detail': files[0]['name']})
            parts = []
            for part in example.get('components', []):
                kind = normalize_type(part['type'], catalog)
                entry = catalog.components.get(kind)
                parts.append({'id': part['id'], 'type': kind, 'properties': part.get('properties', {}),
                              'catalog_known': entry is not None,
                              'pins_known': bool(entry and entry.get('pins'))})
                if not entry:
                    blockers.append({'category': 'unsupported_component', 'detail': f'{part["id"]}:{kind}'})
                elif not entry.get('pins'):
                    blockers.append({'category': 'unresolved_pin_layout', 'detail': f'{part["id"]}:{kind}'})
            unavailable = [board for board in boards if board in BOARD_CONFIG
                           and BOARD_CONFIG[board]['simulation'] != 'browser']
            if unavailable:
                blockers.append({'category': 'runtime_unavailable', 'detail': unavailable})
            external_headers = [header for header in headers if header not in ('Arduino.h', 'Wire.h', 'SPI.h', 'EEPROM.h')]
            if external_headers or example.get('libraries'):
                blockers.append({'category': 'dependency_unverified',
                                 'detail': {'headers': external_headers, 'libraries': example.get('libraries', [])}})
            if re.search(r'\b(?:WiFi|WIFI|Bluetooth|BLEDevice|Blynk|HTTPClient|requests|network|socket|MQTT|mqtt)\b', combined):
                blockers.append({'category': 'network_or_radio_requirement',
                                 'detail': 'Network/radio behavior and credentials require separate review; not simulated or verified here.'})
            normalized = None
            canonical = 'not_validated'
            try:
                normalized = normalize_template(example, catalog, library_free=False)
                project = await create_copy(service, normalized)
                service.delete_project(project['id'])
                canonical = 'passed'
            except (ValueError, HTTPException, KeyError, TypeError) as error:
                detail = str(error.detail) if isinstance(error, HTTPException) else str(error)
                blockers.append({'category': 'canonical_validation_gap', 'detail': detail})
                canonical = 'failed'
            selected = example['id'] in STARTER_IDS
            classification = 'selected_starter' if selected else 'blocked' if blockers else 'canonical_candidate_unverified'
            requirements = {
                'purpose': example.get('description', ''), 'boards': boards, 'parts': parts,
                'wiring': normalized['wires'] if normalized else example.get('wires', []),
                'wiring_format': 'canonical' if normalized else 'upstream_unresolved',
                'pins': [{'wire': wire['id'], 'start': wire.get('start'), 'end': wire.get('end')}
                         for wire in example.get('wires', [])],
                'firmware': {'language': language, 'files': [file['name'] for file in files] or ['sketch.ino'],
                             'files_override_code': bool(files),
                             'source_sha256': hashlib.sha256(combined.encode()).hexdigest()},
                'dependencies': {'declared_libraries': example.get('libraries', []),
                                 'include_headers': headers, 'python_imports': imports},
                'instructions': ['Review component and pin gaps before importing.',
                                 'Install required board core and libraries; compile the actual source.',
                                 'Use a supported runtime and test the described behavior; static validation is not behavioral verification.'],
            }
            records.append({'id': example['id'], 'title': example['title'],
                            'category': example.get('category'), 'difficulty': example.get('difficulty'),
                            'boards': boards, 'components': parts, 'language': language,
                            'dependencies': requirements['dependencies'], 'classification': classification,
                            'selected': selected, 'requirements': requirements, 'blockers': blockers,
                            'verification': {'canonical_service': canonical, 'real_compile': 'not_verified',
                                             'browser_run': 'not_verified', 'electrical_safety': 'not_verified'},
                            'provenance': {'source': UPSTREAM_PATH, 'example_id': example['id'],
                                           'preview': f'examples-thumbs/{example["id"]}.webp'},
                            'adaptations': normalized['adaptations'] if normalized else []})
    return {'schema_version': 1, 'total': len(records),
            'source': 'backend/templates/velxio-examples.json', 'source_sha256': hashlib.sha256(raw).hexdigest(),
            'method': 'Normalized metadata and sequential canonical HardwareService validation in disposable storage. No real compilation, simulation, network access, or electrical-safety verification. Dependency detection is static, not a package-resolution proof.',
            'counts': {'classification': dict(Counter(record['classification'] for record in records)),
                       'language': dict(Counter(record['language'] for record in records)),
                       'canonical_validation': dict(Counter(record['verification']['canonical_service'] for record in records)),
                       'blocker_categories': dict(Counter(category for record in records
                           for category in {blocker['category'] for blocker in record['blockers']}))},
            'examples': records}


def main():
    parser = argparse.ArgumentParser(description='Analyze every exported Velxio example without importing it into user storage.')
    parser.add_argument('--source', type=Path, default=EXAMPLES_PATH)
    parser.add_argument('--output', type=Path, default=ROOT / 'backend/templates/example-analysis.json')
    args = parser.parse_args()
    report = asyncio.run(analyze(args.source))
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'total': report['total'], 'counts': report['counts']}))


if __name__ == '__main__':
    main()
