from backend.agent import _provider_error


class ProviderError(Exception):
    def __init__(self, status, body=None):
        self.status_code = status
        self.body = body


def test_rejected_tools_are_specific_without_raw_provider_data():
    message = _provider_error(ProviderError(400, {'message': 'tool schema invalid', 'key': 'secret'}))
    assert 'tool-calling request' in message
    assert 'secret' not in message


def test_model_and_context_errors_are_specific():
    assert 'model is unavailable' in _provider_error(ProviderError(404))
    assert 'conversation length' in _provider_error(ProviderError(400, {'message': 'context token limit'}))
    assert 'supported request parameters' in _provider_error(ProviderError(422))
