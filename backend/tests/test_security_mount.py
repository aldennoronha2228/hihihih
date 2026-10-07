from fastapi.testclient import TestClient
from backend.app import create_app


def test_live_api_stack_rejects_oversized_chat_body():
    response = TestClient(create_app(api_key='test')).post('/api/chat', content='x' * 600001, headers={'Content-Type': 'application/json'})
    assert response.status_code == 413
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_production_mode_without_token_fails_closed(monkeypatch):
    monkeypatch.setenv('WIREUP_DEPLOYMENT', 'production')
    monkeypatch.delenv('WIREUP_ACCESS_TOKEN', raising=False)
    import pytest
    with pytest.raises(ValueError):
        with TestClient(create_app(api_key='test')):
            pass
