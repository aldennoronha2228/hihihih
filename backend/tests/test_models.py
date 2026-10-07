import traceback

import pytest

import backend.models as models
from backend.models import NVIDIA_BASE_URL, build_model, model_options


def test_nvidia_client_uses_fixed_endpoint_and_configured_model(monkeypatch):
    monkeypatch.delenv('NVIDIA_MAX_TOKENS', raising=False)
    model = build_model('nvidia', 'test-not-real-key', 'z-ai/glm-5.3')
    assert model.model_name == 'z-ai/glm-5.3'
    assert str(model.openai_api_base) == NVIDIA_BASE_URL
    assert model.streaming is True
    assert model.max_retries == 0
    assert model.max_tokens == 4096
    assert model.stream_usage is False


@pytest.mark.parametrize(('model_name', 'options'), [
    ('openai/gpt-oss-120b', {'model_kwargs': {'include_reasoning': True}}),
    ('openai/gpt-oss-20b', {'model_kwargs': {'include_reasoning': True}}),
    ('qwen/qwen3-32b', {'reasoning_format': 'parsed'}),
    ('llama-3.3-70b-versatile', {}),
])
def test_groq_default_budget_preserves_provider_options(monkeypatch, model_name, options):
    monkeypatch.delenv('GROQ_MAX_TOKENS', raising=False)
    monkeypatch.setattr(models, 'init_chat_model', lambda name, **kwargs: (name, kwargs))
    name, kwargs = build_model('groq', 'test-not-real-key', model_name)
    assert name == model_name
    assert kwargs == {
        'model_provider': 'groq', 'api_key': 'test-not-real-key',
        'temperature': 0.5, 'max_retries': 0, 'timeout': 20,
        'max_tokens': 4096, **options,
    }


@pytest.mark.parametrize(('provider', 'env_name', 'model_name'), [
    ('groq', 'GROQ_MAX_TOKENS', 'openai/gpt-oss-120b'),
    ('nvidia', 'NVIDIA_MAX_TOKENS', 'z-ai/glm-5.3'),
])
@pytest.mark.parametrize('value', ['1', '4096', '6144', '8192', ' 4096 '])
def test_provider_budget_accepts_configured_bounds(monkeypatch, provider, env_name, model_name, value):
    monkeypatch.setenv(env_name, value)
    monkeypatch.setattr(models, 'init_chat_model', lambda name, **kwargs: kwargs)
    model = build_model(provider, 'test-not-real-key', model_name)
    tokens = model['max_tokens'] if provider == 'groq' else model.max_tokens
    assert tokens == int(value)


@pytest.mark.parametrize(('provider', 'env_name', 'model_name'), [
    ('groq', 'GROQ_MAX_TOKENS', 'openai/gpt-oss-120b'),
    ('nvidia', 'NVIDIA_MAX_TOKENS', 'z-ai/glm-5.3'),
])
@pytest.mark.parametrize('value', [
    '', '0', '-1', '8193', '1000000', '1.5', 'secret-budget-value',
    pytest.param('9' * 5000, id='oversized-integer'),
])
def test_provider_budget_failures_are_sanitized(monkeypatch, provider, env_name, model_name, value):
    monkeypatch.setenv(env_name, value)

    def unexpected_client(*args, **kwargs):
        pytest.fail('Invalid configuration must fail before constructing a client.')

    monkeypatch.setattr(models, 'init_chat_model', unexpected_client)
    monkeypatch.setattr(models, 'ChatOpenAI', unexpected_client)
    key = 'secret-api-key'
    with pytest.raises(ValueError) as caught:
        build_model(provider, key, model_name)
    assert str(caught.value) == f'{env_name} must be an integer between 1 and 8192.'
    formatted = ''.join(traceback.format_exception(caught.value))
    assert 'secret-budget-value' not in formatted
    assert 'secret-api-key' not in formatted
    assert 'invalid literal' not in formatted
    assert caught.value.__cause__ is None


def test_provider_budgets_are_independent(monkeypatch):
    monkeypatch.setenv('GROQ_MAX_TOKENS', '8192')
    monkeypatch.setenv('NVIDIA_MAX_TOKENS', '1')
    monkeypatch.setattr(models, 'init_chat_model', lambda name, **kwargs: kwargs)
    assert build_model('groq', 'test-key', 'openai/gpt-oss-120b')['max_tokens'] == 8192
    assert build_model('nvidia', 'test-key', 'z-ai/glm-5.3').max_tokens == 1


@pytest.mark.parametrize(('provider', 'model_name'), [
    ('groq', 'openai/gpt-oss-120b'),
    ('nvidia', 'z-ai/glm-5.3'),
])
def test_provider_models_preserve_streaming_and_allow_phase_override(monkeypatch, provider, model_name):
    monkeypatch.delenv('GROQ_MAX_TOKENS', raising=False)
    monkeypatch.delenv('NVIDIA_MAX_TOKENS', raising=False)
    model = build_model(provider, 'test-not-real-key', model_name)
    assert model.max_tokens == 4096
    assert callable(model.astream)
    bound = model.bind(max_tokens=8192)
    assert bound.kwargs['max_tokens'] == 8192
    assert callable(bound.astream)
    assert model.max_tokens == 4096


def test_invalid_provider_budgets_do_not_affect_other_providers(monkeypatch):
    monkeypatch.setenv('GROQ_MAX_TOKENS', 'secret-invalid-value')
    monkeypatch.setenv('NVIDIA_MAX_TOKENS', 'secret-invalid-value')
    monkeypatch.setattr(models, 'build_bedrock', lambda name: name)
    assert build_model('bedrock', None, 'bedrock-model') == 'bedrock-model'
    assert build_model('azure', 'test-key', 'azure-model').max_tokens == 4096


def test_provider_status_exposes_no_keys(monkeypatch):
    monkeypatch.setattr(models, 'bedrock_configured', lambda: True)
    monkeypatch.setenv('AZURE_API_KEY', 'secret-azure')
    monkeypatch.setenv('GROQ_API_KEY', 'secret-groq')
    monkeypatch.setenv('NVIDIA_API_KEY', 'secret-nvidia')
    monkeypatch.setenv('NVIDIA_MODEL', 'z-ai/glm-5.3')
    options = model_options()
    assert all(option['configured'] for option in options)
    assert options[1]['model'] == 'z-ai/glm-5.3'
    assert 'secret' not in str(options)
