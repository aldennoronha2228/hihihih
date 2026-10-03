import asyncio
import copy
import hashlib
import json
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from starlette.requests import HTTPConnection

from backend.sample_guidance import setup_guidance
from backend.hardware import (
    BOARD_ALIASES, BOARD_CONFIG, HardwareService, local_connection, service,
    source_text,
)

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_PATH = ROOT / 'backend/templates/velxio-examples.json'
STARTER_IDS = ('serial-hello', 'button-led', 'nano-button-led', 'mega-blink',
               'pico-blink', 'pico-button-led')
UPSTREAM_PATH = 'vendor/velxio/frontend/src/data/examples.ts'


def normalize_type(value, catalog):
    value = value.removeprefix('wokwi-')
    value = BOARD_ALIASES.get(value, value)
    if value not in catalog.components:
        value = next((key for key, entry in catalog.components.items()
                      if entry.get('tagName') == value), value)
    return value


def example_boards(example, catalog):
    explicit = [normalize_type(board['boardKind'], catalog)
                for board in example.get('boards', [])]
    declared = example.get('boardType')
    if declared:
        explicit.append(normalize_type(declared, catalog))
    placed = [normalize_type(part['type'], catalog) for part in example.get('components', [])
              if normalize_type(part['type'], catalog) in BOARD_CONFIG
              or catalog.components.get(normalize_type(part['type'], catalog), {}).get('category') == 'boards']
    return list(dict.fromkeys(explicit or placed or ['arduino-uno']))


def example_source(example):
    files = example.get('files')
    if files:
        if len(files) != 1:
            raise ValueError('Multiple source files are not supported by the single-sketch service.')
        if not files[0]['name'].endswith('.ino'):
            raise ValueError('Only Arduino .ino source files are supported.')
        return files[0]['content']
    boards = example.get('boards', [])
    if len(boards) == 1 and 'code' in boards[0]:
        return boards[0]['code']
    return example.get('code', '')


def resolve_pin(kind, pin, catalog):
    entry = catalog.components[kind]
    pin = entry.get('pin_aliases', {}).get(pin, pin)
    if pin == 'GND' and 'GND.1' in entry['pins']:
        pin = 'GND.1'
    if kind in ('arduino-nano', 'arduino-mega') and pin.startswith('D') and pin[1:].isdigit():
        pin = pin[1:]
    if pin not in entry['pins']:
        raise ValueError(f'Unknown pin {kind}:{pin}.')
    return pin


def normalize_template(example, catalog, library_free=True):
    boards = example_boards(example, catalog)
    if len(boards) != 1 or len(example.get('boards', [])) > 1 or boards[0] not in BOARD_CONFIG:
        raise ValueError('A single canonical supported board is required.')
    if example.get('languageMode', 'arduino') != 'arduino':
        raise ValueError('Only Arduino firmware is supported.')
    board = boards[0]
    source = source_text(example_source(example))
    if library_free and (example.get('libraries') or re.search(r'^\s*#\s*include', source, re.MULTILINE)):
        raise ValueError('Starters must not require additional libraries.')
    adaptations = []
    components = copy.deepcopy(example.get('components', []))
    wires = copy.deepcopy(example.get('wires', []))
    if example['id'] == 'pico-blink':
        components, wires = [], []
        adaptations.append('Omitted upstream external LED, 220 ohm resistor and wires: GP25 is onboard-only, not an exposed Pico header pin. Firmware still blinks LED_BUILTIN (GPIO25); source is unchanged.')
    board_aliases = {'board', *BOARD_CONFIG, *BOARD_ALIASES}
    parts = []
    for part in components:
        kind = normalize_type(part['type'], catalog)
        entry = catalog.components.get(kind)
        if not entry:
            raise ValueError(f'Unknown component type {kind}.')
        if kind in BOARD_CONFIG or entry.get('category') == 'boards':
            if kind != board:
                raise ValueError('Placed board conflicts with selected board.')
            board_aliases.add(part['id'])
            continue
        properties = part.get('properties', {})
        if kind == 'led' and 'pin' in properties:
            properties.pop('pin')
            adaptations.append(f'Removed {part["id"]}.pin display metadata; explicit wires determine connectivity.')
        parts.append({'id': part['id'], 'type': kind, 'x': part.get('x', 300),
                      'y': part.get('y', 100), 'rotation': part.get('rotation', 0),
                      'properties': properties})
    part_types = {part['id']: part['type'] for part in parts}
    if len(part_types) != len(parts) or any(part['id'] in board_aliases for part in parts):
        raise ValueError('Duplicate or reserved component identifier.')
    part_types['board'] = board
    normalized_wires = []
    for wire in wires:
        endpoints = []
        for side in ('start', 'end'):
            endpoint = wire[side]
            component = endpoint['componentId']
            component = 'board' if component in board_aliases else component
            if component not in part_types:
                raise ValueError(f'Unknown wire component {component}.')
            endpoints.append({'component': component,
                              'pin': resolve_pin(part_types[component], endpoint['pinName'], catalog)})
        normalized_wires.append({'id': wire['id'], 'from': endpoints[0], 'to': endpoints[1],
                                 'color': wire.get('color', '#22c55e')})
    return {'id': example['id'], 'title': example['title'], 'description': example['description'],
            'category': example['category'], 'difficulty': example['difficulty'], 'board': board,
            'parts': parts, 'wires': normalized_wires, 'source': source, 'adaptations': adaptations}


async def create_copy(hardware_service, template):
    project = hardware_service.create_project(template['title'], template['board'])
    project_id = project['id']
    try:
        for name, mutations in (('add_component', template['parts']), ('connect_wire', template['wires']),
                                ('generate_firmware', [{'source': template['source']}])):
            for mutation in mutations:
                project = await hardware_service.command(
                    project_id, name, {**copy.deepcopy(mutation), 'expected_revision': project['revision']})
        return project
    except BaseException:
        hardware_service.delete_project(project_id)
        raise


class SampleCatalog:
    def __init__(self, hardware_service, examples_path=EXAMPLES_PATH):
        self.hardware_service = hardware_service
        path = Path(examples_path)
        raw = path.read_bytes()
        examples = json.loads(raw)
        by_id = {example['id']: example for example in examples}
        if len(by_id) != len(examples):
            raise ValueError('Duplicate upstream example identifiers.')
        self.templates = {key: normalize_template(by_id[key], hardware_service.catalog) for key in STARTER_IDS}
        self.source_hash = hashlib.sha256(raw).hexdigest()
        self.validated = False
        self.validation_lock = asyncio.Lock()

    async def validate(self):
        async with self.validation_lock:
            if self.validated:
                return
            # Disposable projects exercise canonical persistence and command validation without publishing copies.
            with tempfile.TemporaryDirectory(prefix='wireup-samples-') as directory:
                validator = HardwareService(directory, catalog=self.hardware_service.catalog)
                for template in self.templates.values():
                    project = await create_copy(validator, template)
                    validator.delete_project(project['id'])
            self.validated = True

    def summaries(self):
        if not self.validated:
            raise RuntimeError('Validate all starter templates before publishing the catalog.')
        summaries = []
        for template in self.templates.values():
            board = BOARD_CONFIG[template['board']]
            pins = sorted({endpoint['pin'] for wire in template['wires']
                           for endpoint in (wire['from'], wire['to']) if endpoint['component'] == 'board'})
            if template['id'] in ('mega-blink', 'pico-blink'):
                pins.append('13 (onboard LED)' if template['board'] == 'arduino-mega' else 'GPIO25 (onboard LED only)')
            instructions = ['Open an editable copy; the starter already chooses its documented board.',
                            'Compile firmware locally, then connect the browser hardware workspace and run.']
            if 'button' in template['id']:
                instructions.append('Press and release the button; the external LED should follow. INPUT_PULLUP makes a press active LOW; keep the explicit 220 ohm series resistor.')
            elif template['id'] == 'serial-hello':
                instructions.append('Inspect the serial monitor: greeting on startup, uptime every two seconds (9600 baud).')
            else:
                instructions.append('Observe the onboard LED toggle every 500 ms; inspect LED ON/OFF serial messages.')
            thumb = f'examples-thumbs/{template["id"]}.webp'
            summaries.append({key: template[key] for key in ('id', 'title', 'description', 'category', 'difficulty', 'board')} | {
                'thumbnail': f'/starter-thumbnails/{template["id"]}.webp' if (ROOT / 'vendor/velxio/frontend/public' / thumb).is_file() else None,
                'thumbnail_is_upstream': True,
                'verification': 'canonical_service_validated',
                'verification_status': {'canonical_validation': 'passed', 'real_compile': 'not_verified',
                                        'browser_run': 'not_verified', 'simulation_verified': False},
                'available': True, 'compile_supported': board['compile'],
                'simulation': board['simulation'], 'runtime': board['runtime'],
                'requirements': {
                    'parts': [{'id': 'board', 'type': template['board']}, *copy.deepcopy(template['parts'])],
                    'wiring': copy.deepcopy(template['wires']), 'pins': pins,
                    'firmware': {'filename': 'sketch.ino', 'language': 'arduino', 'fqbn': board['fqbn'],
                                 'libraries': [], 'source_sha256': hashlib.sha256(template['source'].encode()).hexdigest()},
                    'libraries': [], 'instructions': instructions,
                    'verification': 'Canonical validation only; real compilation and browser execution are not yet verified.'},
                'provenance': {'source': UPSTREAM_PATH, 'export': 'backend/templates/velxio-examples.json',
                               'export_sha256': self.source_hash, 'example_id': template['id'],
                               'preview': thumb, 'source_modified': False,
                               'adaptations': copy.deepcopy(template['adaptations'])}})
        return summaries


def create_router(hwservice=None, examples_path=EXAMPLES_PATH):
    hwservice = service if hwservice is None else hwservice
    catalog = SampleCatalog(hwservice, examples_path)

    @asynccontextmanager
    async def lifespan(api):
        await catalog.validate()
        yield

    async def local_only(connection: HTTPConnection, response: Response):
        if not local_connection(connection):
            raise HTTPException(403, 'Hardware samples API is local-only; loopback client, Host, and Origin are required.')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'

    api = APIRouter(prefix='/api/hardware/samples', tags=['hardware-samples'],
                    dependencies=[Depends(local_only)], lifespan=lifespan)

    @api.get('')
    async def list_samples():
        await catalog.validate()
        return {'samples': catalog.summaries()}

    @api.get('/all')
    async def all_examples():
        report = json.loads((ROOT / 'backend/templates/example-analysis.json').read_text(encoding='utf-8'))
        return {'total': report['total'], 'examples': [{
            'id': example['id'], 'title': example['title'], 'category': example['category'],
            'boards': example['boards'], 'language': example['language'],
            'available': example['id'] in catalog.templates,
            'blockers': example.get('blockers', []), 'dependencies': example.get('dependencies', {}),
            'thumbnail': f'/example-thumbnails/{example["id"]}.webp' if (ROOT / 'public/example-thumbnails' / f'{example["id"]}.webp').is_file() else None,
        } for example in report['examples']]}

    @api.post('/{sample_id}/open')
    async def open_sample(sample_id: str):
        await catalog.validate()
        template = catalog.templates.get(sample_id)
        if template is None:
            raise HTTPException(404, 'Unknown starter project.')
        project = await create_copy(hwservice, template)
        return {**project, 'setup_guidance': setup_guidance(template)}

    return api


router = create_router()
