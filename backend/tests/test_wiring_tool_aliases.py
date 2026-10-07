import asyncio
import json
from langchain_core.messages import AIMessageChunk, HumanMessage
from backend import agent
from backend.hardware import HardwareService


def test_wire_circuit_preserves_from_alias_through_langgraph(tmp_path, monkeypatch):
    service = HardwareService(tmp_path)
    project = service.create_project('Agent wire regression', 'arduino-uno')
    monkeypatch.setattr(agent, '_get_service', lambda: service)
    class Model:
        model_name = 'test'
        def __init__(self):
            self.tool_sets = []
        def bind_tools(self, tools, **kwargs):
            self.tool_sets.append({tool.name for tool in tools})
            return self
        async def astream(self, history):
            tool_messages = [message for message in history if message.type == 'tool']
            if not tool_messages:
                yield AIMessageChunk(content='', tool_call_chunks=[{'name': 'read_project', 'args': '{}', 'id': 'read', 'index': 0}])
            elif len(tool_messages) == 1:
                plan = {'board': 'arduino-uno', 'behavior': 'Connect the requested board pins.',
                        'parts': [], 'libraries': [], 'operations': ['wire_circuit']}
                yield AIMessageChunk(content='', tool_call_chunks=[{
                    'name': 'assess_project_feasibility', 'args': json.dumps({'plan': plan}), 'id': 'assess', 'index': 0,
                }])
            elif len(tool_messages) == 2:
                yield AIMessageChunk(content='', tool_call_chunks=[{'name': 'wire_circuit', 'args': '{"batch":[{"from":{"component":"board","pin":"13"},"to":{"component":"board","pin":"12"}}],"expected_revision":1}', 'id': 'wire', 'index': 0}])
            else:
                yield AIMessageChunk(content='The requested connection was saved.')
    model = Model()
    async def run():
        return [event async for event in agent.stream_agent(model, [HumanMessage(content='Connect these pins')], project['id'], project['runtime_token'], requirements={'board': 'arduino-uno'})]
    events = asyncio.run(run())
    assert events[-1]['status'] == 'success'
    assert model.tool_sets == [set(agent._ASSESSMENT_TOOLS)] * 2 + [set(agent.TOOL_NAMES) - {'ask_project_questions', 'assess_project_feasibility'}] * 2
    assert events[-1]['modelCalls'] == 4
    assert events[-1]['toolCalls'] == 5
    assert events[-1]['successfulTools'] == {
        'read_project': 2, 'wire_circuit': 1, 'validate_circuit': 1,
    }
    assert any(event['type'] == 'feasibility' and event['status'] == 'approved' for event in events)
    saved = service.get_project(project['id'])
    assert len(saved['wires']) == 1
    assert saved['wires'][0]['from'] == {'component': 'board', 'pin': '13'}
    assert not any(event.get('status') == 'error' for event in events)
