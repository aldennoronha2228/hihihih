from backend.models import build_model, AZURE_BASE_URL


def test_azure_uses_user_endpoint_without_temperature(monkeypatch):
    monkeypatch.setenv('AZURE_BASE_URL', AZURE_BASE_URL)
    model = build_model('azure', 'test-key', 'gpt-6.1-sol')
    assert model.model_name == 'gpt-6.1-sol'
    assert model.openai_api_base == AZURE_BASE_URL
    assert model.default_headers['api-key'] == 'test-key'
    assert model.temperature is None
    assert model.streaming is True
    assert model.max_retries == 0


def test_azure_deployment_name_can_be_configured(monkeypatch):
    from backend.models import model_options
    monkeypatch.setenv('AZURE_MODEL_ID', 'my-gpt-deployment')
    monkeypatch.setenv('AZURE_API_KEY', 'private-key')
    option = next(item for item in model_options() if item['id'] == 'azure')
    assert option['model'] == 'my-gpt-deployment'
    assert option['configured']
    assert 'private-key' not in str(option)
