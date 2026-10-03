import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService


def test_delete_project_removes_persisted_project(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project('Delete me')
    assert service.delete_project(project['id']) == {'deleted': project['id']}
    assert service.list_projects()['projects'] == []
    with pytest.raises(HTTPException) as error:
        service.get_project(project['id'])
    assert error.value.status_code == 404


def test_open_workspace_cannot_be_deleted(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project()
    service.runtime.sessions[project['id']] = object()
    with pytest.raises(HTTPException) as error:
        service.delete_project(project['id'])
    assert error.value.status_code == 409
    assert service.get_project(project['id'])['id'] == project['id']


def test_delete_rejects_unsafe_identifier(tmp_path):
    with pytest.raises(HTTPException):
        HardwareService(tmp_path).delete_project('../outside')
