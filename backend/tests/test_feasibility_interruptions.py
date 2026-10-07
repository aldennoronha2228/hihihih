from backend.hardware import HardwareService
from backend.feasibility import assess


def test_firmware_library_does_not_interrupt_supported_build(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    report = assess(service, project['id'], {'board': 'arduino-uno', 'parts': [{'type': 'led'}, {'type': 'resistor'}], 'libraries': ['Servo'], 'operations': ['add_component', 'compile_firmware']})
    assert report['status'] == 'approved'
    assert report['issues'] == []
    assert report['choices'] == []
    assert any(notice['code'] == 'libraries' for notice in report['notices'])


def test_real_missing_part_still_blocks_and_requires_decision(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    report = assess(service, project['id'], {'board': 'arduino-uno', 'parts': [{'type': 'nonexistent-sensor'}], 'operations': ['add_component']})
    assert report['status'] == 'blocked'
    assert report['issues']
    assert report['choices']
