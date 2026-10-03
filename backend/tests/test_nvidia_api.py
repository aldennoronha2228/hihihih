from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk

from backend.app import create_app


class Model:
    def bind_tools(self, tools, **kwargs):
        return self

    async def astream(self, messages):
        yield AIMessageChunk(content='NVIDIA test response')


def test_nvidia_request_selects_nvidia_backend(monkeypatch):
    from backend import app as module
    selected = []
    monkeypatch.setattr(module, 'build_model', lambda provider, key, model: selected.append((provider, model)) or Model())
    response = TestClient(create_app(api_key='test-key')).post('/api/chat', json={'provider': 'nvidia', 'messages': [{'role': 'user', 'content': 'Hello'}]})
    assert response.status_code == 200
    assert selected[0][0] == 'nvidia'
    assert 'NVIDIA test response' in response.text


def test_unknown_provider_is_rejected():
    response = TestClient(create_app(api_key='test')).post('/api/chat', json={'provider': 'unknown', 'messages': [{'role': 'user', 'content': 'Hello'}]})
    assert response.status_code == 422
