from backend.hardware import HardwareService


def test_dip_switch_verified_scope_and_pin_pairs(tmp_path):
    component=HardwareService(tmp_path).catalog.components['dip-switch-8']
    assert component['simulation_boards']==['arduino-uno','arduino-nano','arduino-mega']
    assert {f'{index}{side}' for index in range(1,9) for side in ('a','b')}==set(component['pins'])
    assert 'INPUT_PULLUP' in component['simulation_scope']
