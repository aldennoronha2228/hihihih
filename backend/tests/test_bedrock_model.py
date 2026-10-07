from backend.bedrock_model import build_bedrock, bedrock_configured
from backend.agent import _provider_error


def test_bedrock_config_caps_output_and_selects_iam(monkeypatch):
    from backend import bedrock_model as module
    monkeypatch.setenv('AWS_REGION', 'eu-north-1')
    monkeypatch.setenv('AWS_ACCESS_KEY_ID', 'test-access')
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY', 'test-secret')
    monkeypatch.setenv('BEDROCK_AUTH_MODE', 'iam')
    monkeypatch.setattr(module, 'dotenv_values', lambda path: {'BEDROCK_AUTH_MODE': 'iam'})
    monkeypatch.setenv('BEDROCK_MAX_TOKENS', '1000000')
    monkeypatch.setenv('BEDROCK_MAX_TOKENS_CEILING', '160000')
    captured = {}
    monkeypatch.setattr(module, 'ChatBedrockConverse', lambda **kwargs: captured.update(kwargs) or captured)
    result = build_bedrock('moonshotai.kimi-k2.5')
    assert result['max_tokens'] == 160000
    assert result['region_name'] == 'eu-north-1'
    assert result['aws_access_key_id'] == 'test-access'
    assert result['bedrock_api_key'] is None
    assert result['supports_tool_choice_values'] == ('auto', 'any')


def test_bedrock_bearer_auth_is_explicit(monkeypatch):
    from backend import bedrock_model as module
    monkeypatch.setenv('BEDROCK_AUTH_MODE', 'api_key')
    monkeypatch.setenv('BEDROCK_API_KEY', 'test-bearer')
    monkeypatch.setattr(module, 'ChatBedrockConverse', lambda **kwargs: kwargs)
    model = build_bedrock('moonshotai.kimi-k2.5')
    assert model['bedrock_api_key'] == 'test-bearer'
    assert model['aws_access_key_id'] is None
    assert bedrock_configured()


def test_explicit_iam_environment_takes_precedence_over_local_bearer(monkeypatch):
    from backend import bedrock_model as module
    monkeypatch.setenv('AWS_ACCESS_KEY_ID', 'old-access')
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY', 'old-secret')
    monkeypatch.setenv('BEDROCK_AUTH_MODE', 'iam')
    monkeypatch.setenv('BEDROCK_API_KEY', 'current-bearer')
    monkeypatch.setattr(module, 'dotenv_values', lambda path: {'BEDROCK_API_KEY': 'current-bearer', 'BEDROCK_MODEL_ID': 'zai.glm-5'})
    monkeypatch.setattr(module, 'ChatBedrockConverse', lambda **kwargs: kwargs)
    model = build_bedrock('zai.glm-5')
    assert model['bedrock_api_key'] is None
    assert model['aws_access_key_id'] == 'old-access'
    assert model['aws_secret_access_key'] == 'old-secret'


def test_forced_tools_map_to_converse_any(monkeypatch):
    from backend.bedrock_chat import WireUpBedrockConverse
    from langchain_aws import ChatBedrockConverse
    captured = {}
    monkeypatch.setattr(ChatBedrockConverse, 'bind_tools', lambda self, tools, **kwargs: captured.update(kwargs) or captured)
    client = WireUpBedrockConverse.model_construct(model_id='moonshotai.kimi-k2.5')
    result = client.bind_tools([], tool_choice='required')
    assert result['tool_choice'] == 'any'


def test_aws_errors_are_safe_and_specific():
    class Error(Exception):
        response = {'Error': {'Code': 'ValidationException', 'Message': 'Operation not allowed'}}
    assert 'Operation not allowed' in _provider_error(Error())
    Error.response = {'Error': {'Code': 'AccessDeniedException', 'Message': 'secret should not appear'}}
    assert 'authorization failed' in _provider_error(Error())
    assert 'secret' not in _provider_error(Error())
