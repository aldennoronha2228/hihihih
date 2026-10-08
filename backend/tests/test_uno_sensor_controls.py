import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService


def test_only_verified_board_peripheral_scope_is_advertised(tmp_path):
    service = HardwareService(tmp_path)
    for kind in ('potentiometer', 'servo', 'hc-sr04', 'rgb-led', 'dht22'):
        assert service.catalog.components[kind]['simulation_boards'] == (['arduino-uno', 'arduino-nano', 'arduino-mega', 'pi-pico', 'pi-pico-w'] if kind == 'potentiometer' else ['arduino-uno', 'arduino-nano', 'arduino-mega'])
        assert service.catalog.components[kind]['simulation_scope']


def test_dht_controls_match_original_sensor_range(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project('DHT', 'arduino-uno')
    value = service._mutate(project['id'], 'add_component', {'type': 'dht22', 'id': 'sensor', 'properties': {'temperature': 18, 'humidity': 65}})
    assert value['components'][-1]['properties']['temperature'] == 18
    with pytest.raises(HTTPException):
        service._mutate(project['id'], 'modify_component', {'id': 'sensor', 'properties': {'humidity': 101}})


def test_hcsr04_controls_match_upstream_model_bounds(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project('Distance', 'arduino-uno')
    updated = service._mutate(project['id'], 'add_component', {'type': 'hc-sr04', 'id': 'sensor', 'properties': {'distance': 100}})
    assert updated['components'][-1]['properties']['distance'] == 100
    with pytest.raises(HTTPException):
        service._mutate(project['id'], 'modify_component', {'id': 'sensor', 'properties': {'distance': 500}})
