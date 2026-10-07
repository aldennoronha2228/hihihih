import hashlib
import json
from pathlib import Path
from backend.example_requirements import EXAMPLES_PATH, get_example_reference, search_example_requirements


def test_every_upstream_example_has_source_grounded_analysis():
    raw=json.loads(EXAMPLES_PATH.read_text(encoding='utf-8'))
    data=json.loads(EXAMPLES_PATH.with_name('example-build-knowledge.json').read_text(encoding='utf-8'))
    assert len(data['examples'])==len(raw)==321
    assert {item['id'] for item in data['examples']}=={item['id'] for item in raw}
    assert data['export_sha256']==hashlib.sha256(EXAMPLES_PATH.read_bytes()).hexdigest()
    assert data['summary']['live_compiled_in_this_analysis']==0
    assert data['summary']['live_simulated_in_this_analysis']==0
    for record in data['examples']:
        assert 'wiring' in record and 'firmware' in record and 'limitations' in record
        assert record['verification']['real_compile']=='not_verified'


def test_basic_arduino_blink_ranks_above_unrelated_transistor_examples():
    matches=search_example_requirements('Arduino LED blink resistor compile',3,board='arduino-uno')['examples']
    assert matches[0]['id']=='blink-led'
    reference=get_example_reference(matches[0]['id'])
    assert reference['normalized_template'] is not None
    assert reference['build_knowledge']['canonical_mapping_available'] is True
    assert reference['connection_count'] == len(reference['wires'])
    assert reference['build_knowledge']['source_facts']['delay_ms_literals']==[1000,1000]
    assert 'void setup' in reference['source']
