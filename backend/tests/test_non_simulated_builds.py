from backend.hardware import HardwareService
from backend.feasibility import assess, check_operation


def test_esp32_build_is_approved_without_simulation(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project('ESP build','esp32-devkit-v1')
    report=assess(service,project['id'],{'board':'esp32-devkit-v1','parts':[{'type':'led'}],'operations':['add_component','generate_firmware','compile_firmware','run_simulation']})
    assert report['status']=='approved'
    assert 'compile_firmware' in report['plan']['operations']
    assert 'run_simulation' not in report['plan']['operations']
    assert any(notice['code']=='board_runtime' for notice in report['notices'])
    check_operation(service,project['id'],report['id'],'add_component',{'type':'led'})


def test_linux_pi_uses_python_source_and_skips_arduino_compile(tmp_path):
    service=HardwareService(tmp_path)
    project=service.create_project('Pi build','raspberry-pi-4')
    assert project['firmware']['filename']=='main.py'
    assert project['firmware']['source']==''
    report=assess(service,project['id'],{'board':'raspberry-pi-4','parts':[{'type':'led'}],'operations':['add_component','generate_firmware','compile_firmware','run_simulation']})
    assert report['status']=='approved'
    assert report['plan']['operations']==['add_component','generate_firmware']
    assert any(notice['code']=='board_compile' for notice in report['notices'])
