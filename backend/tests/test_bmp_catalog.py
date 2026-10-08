import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService


def test_bmp_controls_and_actual_pins(tmp_path):
    service=HardwareService(tmp_path)
    assert service.catalog.components['bmp280']['pins']==['SDA','SCL','GND','VCC']
    project=service.create_project('BMP','arduino-uno')
    service._mutate(project['id'],'add_component',{'type':'bmp280','id':'sensor','properties':{'temperature':30,'pressure':950,'i2cAddress':'0x77'}})
    with pytest.raises(HTTPException):service._mutate(project['id'],'modify_component',{'id':'sensor','properties':{'pressure':2000}})
    with pytest.raises(HTTPException):service._mutate(project['id'],'modify_component',{'id':'sensor','properties':{'i2cAddress':'0x12'}})
