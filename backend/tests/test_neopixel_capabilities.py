from backend.hardware import HardwareService


def test_addressable_led_scopes_are_explicit():
    catalog=HardwareService().catalog.components
    for kind in ('neopixel','led-ring','neopixel-matrix'):
        assert catalog[kind]['simulation_boards']==['arduino-uno']
        assert 'DOUT chaining' in catalog[kind]['simulation_scope']
        assert 'DIN' in catalog[kind]['pins']
