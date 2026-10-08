import os
from backend.hardware import HardwareService


def test_windows_transient_replace_lock_is_retried(tmp_path, monkeypatch):
    service = HardwareService(tmp_path)
    project = service.create_project('Retry save', 'arduino-uno')
    original = os.replace
    calls = []
    def replace(source, destination):
        calls.append(1)
        if len(calls) == 1:
            raise PermissionError('Temporary scanner lock')
        return original(source, destination)
    monkeypatch.setattr(os, 'replace', replace)
    if os.name != 'nt': return
    project['name'] = 'Saved after retry'
    service._save(project)
    assert service.get_project(project['id'])['name'] == 'Saved after retry'
    assert len(calls) == 2
    assert not list(tmp_path.glob('*.tmp'))
