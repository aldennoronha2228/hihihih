import asyncio
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from backend.hardware import HardwareService


def test_busy_compiler_preserves_last_successful_artifact(tmp_path, monkeypatch):
    service = HardwareService(tmp_path)
    project = service.create_project('Preserve compiled project', 'arduino-uno')
    project['compiler'] = {'status': 'simulation_ready', 'artifact': {'id': 'old-success', 'board': 'arduino-uno', 'source_revision': 1, 'project_revision': 1}}
    service._save(project)
    service.compile_gate.acquire = AsyncMock(side_effect=TimeoutError())
    async def run():
        with pytest.raises(HTTPException) as error:
            await service.command(project['id'], 'compile_firmware')
        assert error.value.status_code == 503
    asyncio.run(run())
    saved = service.get_project(project['id'])
    assert saved['compiler']['artifact']['id'] == 'old-success'
    assert saved['compiler']['status'] == 'simulation_ready'
