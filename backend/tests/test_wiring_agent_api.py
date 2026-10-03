import asyncio
from backend.hardware import HardwareService


def test_command_wires_batch_atomically_with_actual_catalog(tmp_path):
    service = HardwareService(tmp_path)
    project = service.create_project('Atomic wiring', 'arduino-uno')
    async def run():
        p = await service.command(project['id'], 'add_component', {'type': 'led', 'id': 'led1'})
        p = await service.command(project['id'], 'add_component', {'type': 'resistor', 'id': 'r1', 'properties': {'value': '220'}})
        result = await service.command(project['id'], 'wire_circuit', {'expected_revision': p['revision'], 'batch': [
            {'from': {'component': 'board', 'pin': '13'}, 'to': {'component': 'r1', 'pin': '1'}},
            {'from': {'component': 'r1', 'pin': '2'}, 'to': {'component': 'led1', 'pin': 'A'}},
            {'from': {'component': 'led1', 'pin': 'C'}, 'to': {'component': 'board', 'pin': 'GND.1'}},
        ]})
        assert result['project']['revision'] == p['revision'] + 1
        assert len(result['project']['wires']) == 3
        checked = await service.command(project['id'], 'validate_circuit')
        assert checked['valid']
        assert not checked['errors']
    asyncio.run(run())
