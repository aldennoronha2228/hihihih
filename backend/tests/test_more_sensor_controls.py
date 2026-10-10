import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService
from backend.sensor_controls import CONTROLS


def test_original_sensor_controls_are_bounded(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project('Controls','arduino-uno')
    for kind,(key,default) in CONTROLS.items():
        assert service.catalog.components[kind]['pins']
        service._mutate(project['id'],'add_component',{'type':kind,'id':kind,'properties':{key:256}})
        with pytest.raises(HTTPException):service._mutate(project['id'],'modify_component',{'id':kind,'properties':{key:1024}})
