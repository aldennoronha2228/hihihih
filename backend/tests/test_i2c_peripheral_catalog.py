from backend.hardware import HardwareService


def test_oled_protocol_option_is_explicit_and_validated(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project('SPI display', 'arduino-uno')
    value = service._mutate(project['id'], 'add_component', {'type':'ssd1306','id':'oled','properties':{'protocol':'spi'}})
    assert value['components'][-1]['properties']['protocol'] == 'spi'
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        service._mutate(project['id'],'modify_component',{'id':'oled','properties':{'protocol':'invented'}})


def test_display_sensor_pins_match_registered_elements(tmp_path):
    service = HardwareService(tmp_path)
    expected = {
        'ssd1306': ['DATA', 'CLK', 'DC', 'RST', 'CS', '3V3', 'VIN', 'GND'],
        'ssd1306-i2c-4pin': ['GND', 'VCC', 'SCL', 'SDA'],
        'lcd1602-i2c': ['GND', 'VCC', 'SDA', 'SCL'],
        'mpu6050': ['INT', 'AD0', 'XCL', 'XDA', 'SDA', 'SCL', 'GND', 'VCC'],
        'ds1307': ['GND', '5V', 'SDA', 'SCL', 'SQW'],
        'ds3231': ['GND', 'VCC', 'SDA', 'SCL'],
    }
    for kind, pins in expected.items():
        assert service.catalog.components[kind]['pins'] == pins
        assert service.catalog.components[kind]['connectable']
        assert service.catalog.components[kind]['simulation_boards'] == ['arduino-uno']
