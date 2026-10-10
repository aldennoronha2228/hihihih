from backend.hardware import HardwareService


def test_slide_switch_scope_is_board_specific(tmp_path):
    service=HardwareService(tmp_path)
    component=service.catalog.components['slide-switch']
    assert component['pins']==['1','2','3']
    assert component['simulation_boards']==['arduino-uno','arduino-nano','arduino-mega']
    assert 'Open-contact' in component['simulation_scope']
