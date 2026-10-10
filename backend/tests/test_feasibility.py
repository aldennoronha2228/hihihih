import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService
from backend.feasibility import assess, authorize, check_operation


def test_joystick_servo_limitations_are_found_before_mutation(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    report = assess(service, project['id'], {'board': 'arduino-uno', 'parts': [{'type': 'analog-joystick'}, {'type': 'servo', 'quantity': 3}], 'behavior': 'robot arm'})
    assert report['status'] == 'approved'
    assert not any('pins' in issue['code'] for issue in report['issues'])
    assert not any('runtime' in issue['code'] for issue in report['notices'])
    assert any('power' in issue['code'] for issue in report['notices'])
    saved = service.get_project(project['id'])
    assert saved['revision'] == project['revision']
    assert saved['components'] == []
    assert 'hardware_only' not in [choice['id'] for choice in report['choices']]


def test_approval_cannot_allow_unknown_pins_or_stale_revision(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    report = assess(service, project['id'], {'board': 'arduino-uno', 'parts': [{'type': 'servo'}]})
    if report['status'] == 'blocked':
        with pytest.raises(HTTPException): authorize(service, project['id'], {'assessment_id': report['id'], 'choice': 'hardware_only'})
    else:
        if report['status'] != 'approved':
            authorize(service, project['id'], {'assessment_id': report['id'], 'choice': 'hardware_only'})
        with pytest.raises(HTTPException): check_operation(service, project['id'], report['id'], 'add_component', {'type': 'analog-joystick'})


def test_supported_plan_can_pass_read_only_assessment(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    report = assess(service, project['id'], {'board': 'arduino-uno', 'parts': [{'type': 'led'}, {'type': 'resistor'}]})
    assert report['status'] == 'approved'
    assert service.get_project(project['id'])['components'] == []
    assert check_operation(service, project['id'], report['id'], 'add_component', {'type': 'led'})['id'] == report['id']
