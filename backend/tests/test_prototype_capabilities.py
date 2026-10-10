from backend.hardware import HardwareService


def test_prototype_inputs_and_displays_advertise_only_verified_scope(tmp_path):
    service=HardwareService(tmp_path)
    for kind in ('membrane-keypad','ili9341','led-bar-graph'):
        entry=service.catalog.components[kind]
        assert entry['simulation_boards']==['arduino-uno']
        assert entry['pins']
        assert entry['simulation_scope']
