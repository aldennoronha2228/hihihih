import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService


def test_verified_sensor_controls_and_scope(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project('Sensors','arduino-uno')
    for kind in ('ntc-temperature-sensor','photoresistor-sensor','pir-motion-sensor'):
        assert service.catalog.components[kind]['simulation_boards']==['arduino-uno']
        assert service.catalog.components[kind]['pins']
    service._mutate(project['id'],'add_component',{'type':'photoresistor-sensor','id':'ldr','properties':{'lux':750}})
    with pytest.raises(HTTPException):service._mutate(project['id'],'modify_component',{'id':'ldr','properties':{'lux':1001}})
