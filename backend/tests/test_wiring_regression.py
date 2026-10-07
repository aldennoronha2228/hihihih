from backend.hardware import HardwareService, RuntimeBridge


def test_default_parts_do_not_overlap_and_board_aliases_are_canonical(tmp_path):
    service = HardwareService(tmp_path / 'projects', runtime=RuntimeBridge(timeout=0.2))
    project = service.create_project('Wiring regression', 'arduino-nano')
    # Invoke the same mutation implementation used by API and agent tools.
    project = service._mutate(project['id'], 'add_component', {'type': 'led', 'id': 'led'})
    project = service._mutate(project['id'], 'add_component', {'type': 'resistor', 'id': 'resistor'})
    placements = {(part['x'], part['y']) for part in project['components']}
    assert len(placements) == 3
    assert service._endpoint(project, {'component': 'board', 'pin': 'D7'})['pin'] == '7'
    assert service._endpoint(project, {'component': 'board', 'pin': 'GND'})['pin'] == 'GND.1'
