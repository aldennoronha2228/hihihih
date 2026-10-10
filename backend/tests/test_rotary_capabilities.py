from backend.hardware import HardwareService


def test_rotary_encoder_has_exact_pins_and_verified_avr_scope(tmp_path):
    service=HardwareService(tmp_path)
    entry=service.catalog.components['ky-040']
    assert entry['pins']==['CLK','DT','SW','VCC','GND']
    assert entry['simulation_boards']==['arduino-uno','arduino-nano']
    assert 'browser timers' in entry['simulation_scope']
