from backend.hardware import HardwareService
from backend.feasibility import assess, authorize


def plan():
    return {'board': 'arduino-uno', 'behavior': 'Move a servo', 'parts': [{'type': 'servo', 'quantity': 1, 'purpose': 'movement'}], 'libraries': [], 'operations': ['add_component', 'run_simulation']}


def test_identical_review_reuses_identity_and_approval(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    first = assess(service, project['id'], plan())
    assert first['status'] == 'awaiting_approval'
    second = assess(service, project['id'], plan())
    assert second['id'] == first['id']
    authorize(service, project['id'], {'assessment_id': first['id'], 'choice': 'hardware_only'})
    third = assess(service, project['id'], plan())
    assert third['id'] == first['id']
    assert third['status'] == 'approved'


def test_reworded_behavior_does_not_repeat_the_same_decision(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    first = assess(service, project['id'], plan())
    authorize(service, project['id'], {'assessment_id': first['id'], 'choice': 'hardware_only'})
    changed = plan()
    changed['behavior'] = 'Sweep the servo back and forth'
    result = assess(service, project['id'], changed)
    assert result['id'] == first['id']
    assert result['status'] == 'approved'
    assert result['plan']['behavior'] == changed['behavior']


def test_unrelated_project_revision_does_not_repeat_accepted_limitations(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    first = assess(service, project['id'], plan())
    authorize(service, project['id'], {'assessment_id': first['id'], 'choice': 'hardware_only'})
    service._mutate(project['id'], 'add_component', {'type': 'servo', 'id': 'servo1'})
    result = assess(service, project['id'], plan())
    assert result['status'] == 'approved'
    assert result['revision'] != first['revision']


def test_same_limitations_survive_added_compile_operation_and_library(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    first = assess(service, project['id'], plan())
    authorize(service, project['id'], {'assessment_id': first['id'], 'choice': 'hardware_only'})
    changed = plan()
    changed['operations'].append('compile_firmware')
    changed['libraries'] = ['Servo']
    result = assess(service, project['id'], changed)
    assert result['status'] == 'approved'
    assert result['plan']['operations'] == changed['operations']


def test_changed_design_requires_new_review(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    first = assess(service, project['id'], plan())
    changed = plan()
    changed['parts'][0]['quantity'] = 2
    assert assess(service, project['id'], changed)['id'] != first['id']
