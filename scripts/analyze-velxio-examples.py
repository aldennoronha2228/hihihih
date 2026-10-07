"""Generate deterministic, source-grounded build references for every exported example."""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.example_requirements import _source_entries, get_example_reference


def analyze_all():
    source = ROOT / 'backend/templates/velxio-examples.json'
    raw = json.loads(source.read_text(encoding='utf-8'))
    records = []
    for example in raw:
        reference = get_example_reference(example['id'])
        entries = _source_entries(example)
        code = '\n'.join(content for _, content in entries)
        normalized = reference['normalized_template']
        facts = {
            'includes': sorted(set(re.findall(r'^\s*#\s*include\s*[<"]([^>"\n]+)', code, re.M))),
            'python_imports': sorted(set(re.findall(r'^\s*(?:from|import)\s+([\w.]+)', code, re.M))),
            'pin_modes': re.findall(r'\bpinMode\s*\(\s*([^,\n]+),\s*([^\)\n]+)\)', code),
            'digital_writes': re.findall(r'\bdigitalWrite\s*\(\s*([^,\n]+),\s*([^\)\n]+)\)', code),
            'analog_reads': re.findall(r'\banalogRead\s*\(\s*([^\)\n]+)\)', code),
            'delay_ms_literals': [int(value) for value in re.findall(r'\bdelay\s*\(\s*(\d+)\s*\)', code)],
            'serial_baud_literals': [int(value) for value in re.findall(r'\bSerial\d*\.begin\s*\(\s*(\d+)\s*\)', code)],
            'has_setup': bool(re.search(r'\bvoid\s+setup\s*\(', code)),
            'has_loop': bool(re.search(r'\bvoid\s+loop\s*\(', code)),
        }
        records.append({
            'id': example['id'], 'title': example['title'], 'purpose': example.get('description', ''),
            'board': reference['board'], 'boards': reference['boards'],
            'parts': normalized['parts'] if normalized else reference['parts'],
            'wiring': normalized['wires'] if normalized else reference['wires'],
            'firmware': {'source': reference['source'], 'files': reference['files'], 'board_sources': reference['board_sources']},
            'source_facts': facts, 'dependencies': reference.get('dependencies', {}),
            'adaptations': normalized.get('adaptations', []) if normalized else [],
            'canonical_mapping_available': normalized is not None,
            'limitations': reference['limitations'], 'truncated': reference['truncated'],
            'verification': reference['verification_status'],
            'source_sha256': hashlib.sha256(code.encode()).hexdigest(),
        })
    ids = [record['id'] for record in records]
    if len(ids) != len(set(ids)) or len(records) != len(raw):
        raise ValueError('Incomplete or duplicate example analysis.')
    summary = {
        'total': len(records),
        'canonical_mappings': sum(record['canonical_mapping_available'] for record in records),
        'with_limitations': sum(bool(record['limitations']) for record in records),
        'with_source': sum(bool(record['firmware']['source'] or record['firmware']['files']) for record in records),
        'boards': dict(Counter(board for record in records for board in record['boards'])),
        'live_compiled_in_this_analysis': 0, 'live_simulated_in_this_analysis': 0,
    }
    output = {'schema_version': 1, 'source': 'vendor/velxio/frontend/src/data/examples.ts',
              'export_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'method': 'Per-example source extraction, actual catalog normalization, and deterministic source API inspection; not model training or execution.',
              'summary': summary, 'examples': records}
    destination = ROOT / 'backend/templates/example-build-knowledge.json'
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))
    print('Generated', destination.relative_to(ROOT))


if __name__ == '__main__':
    analyze_all()
