from backend.models import NVIDIA_BASE_URL, build_model, model_options


def test_nvidia_client_uses_fixed_endpoint_and_configured_model():
    model = build_model('nvidia', 'test-not-real-key', 'z-ai/glm-5.3')
    assert model.model_name == 'z-ai/glm-5.3'
    assert str(model.openai_api_base) == NVIDIA_BASE_URL
    assert model.streaming is True
    assert model.max_retries == 0


def test_provider_status_exposes_no_keys(monkeypatch):
    monkeypatch.setenv('GROQ_API_KEY', 'secret-groq')
    monkeypatch.setenv('NVIDIA_API_KEY', 'secret-nvidia')
    monkeypatch.setenv('NVIDIA_MODEL', 'z-ai/glm-5.3')
    options = model_options()
    assert all(option['configured'] for option in options)
    assert options[1]['model'] == 'z-ai/glm-5.3'
    assert 'secret' not in str(options)
