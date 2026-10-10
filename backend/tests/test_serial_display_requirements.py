from backend.hardware import HardwareService
from backend.feasibility import assess


def test_serial_display_and_no_oled_do_not_require_a_physical_display(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project(board='arduino-uno')
    report=assess(service,project['id'],{'board':'arduino-uno','parts':[{'type':'ds1307'}],'operations':['add_component','generate_firmware','compile_firmware'],'requirements_text':'Print the display output in Serial monitor. No OLED, no LCD display.'})
    assert report['status']=='approved'
    assert not any(issue['code']=='unresolved_display' for issue in report['issues'])


def test_actual_ssd1306_is_recognized_as_requested_oled(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project(board='arduino-uno')
    report=assess(service,project['id'],{'board':'arduino-uno','parts':[{'type':'ssd1306-i2c-4pin'}],'operations':['add_component'],'requirements_text':'Use an OLED display.'})
    assert report['status']=='approved'


def test_actual_requested_oled_is_not_silently_dropped(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project(board='arduino-uno')
    report=assess(service,project['id'],{'board':'arduino-uno','parts':[{'type':'ds1307'}],'operations':['add_component'],'requirements_text':'Use an OLED display to show the clock.'})
    assert report['status']=='blocked'
    assert any(issue['code']=='unresolved_display' for issue in report['issues'])
