import math
import os

from pathlib import Path
from dotenv import dotenv_values
from botocore.config import Config
from backend.bedrock_chat import WireUpBedrockConverse as ChatBedrockConverse


def bedrock_auth_mode():
    local = dotenv_values(Path(__file__).resolve().parents[1] / '.env')
    return os.getenv('BEDROCK_AUTH_MODE', local.get('BEDROCK_AUTH_MODE') or 'api_key')


def bedrock_configured():
    if bedrock_auth_mode() == 'iam':
        return bool(os.getenv('AWS_ACCESS_KEY_ID', '').strip() and os.getenv('AWS_SECRET_ACCESS_KEY', '').strip())
    return bedrock_auth_mode() == 'api_key' and bool(os.getenv('BEDROCK_API_KEY', '').strip())


def bounded_number(name, default, lower, upper, integer=False):
    raw = os.getenv(name, str(default))
    value = float(raw)
    if not math.isfinite(value) or value < lower:
        raise ValueError(f'{name} must be a finite number >= {lower}.')
    value = min(value, upper)
    return int(value) if integer else value


def build_bedrock(model_name):
    # Output capacity is not the model's input context capacity.
    ceiling = bounded_number('BEDROCK_MAX_TOKENS_CEILING', 160000, 1, 160000, True)
    max_tokens = bounded_number('BEDROCK_MAX_TOKENS', 4096, 1, ceiling, True)
    timeout = bounded_number('BEDROCK_TIMEOUT_MS', 120000, 1000, 1200000) / 1000
    retries = bounded_number('BEDROCK_MAX_RETRIES', 0, 0, 5, True)
    kwargs = {
        'model_id': model_name,
        'region_name': os.getenv('AWS_REGION', 'eu-north-1'),
        'max_tokens': max_tokens,
        'temperature': bounded_number('BEDROCK_TEMPERATURE', .2, 0, 1),
        'top_p': bounded_number('BEDROCK_TOP_P', .9, 0, 1),
        'config': Config(connect_timeout=10, read_timeout=timeout, retries={'total_max_attempts': retries + 1}),
        'supports_tool_choice_values': ('auto', 'any'),
    }
    bearer = os.getenv('BEDROCK_API_KEY', '').strip()
    mode = bedrock_auth_mode()
    if mode not in ('iam', 'api_key'):
        raise ValueError('BEDROCK_AUTH_MODE must be iam or api_key.')
    if mode == 'api_key':
        if not bearer:
            raise ValueError('BEDROCK_API_KEY is required for API-key authentication.')
        kwargs['bedrock_api_key'] = bearer
        kwargs['aws_access_key_id'] = None
        kwargs['aws_secret_access_key'] = None
        kwargs['aws_session_token'] = None
    else:
        kwargs['bedrock_api_key'] = None
        kwargs['aws_access_key_id'] = os.getenv('AWS_ACCESS_KEY_ID')
        kwargs['aws_secret_access_key'] = os.getenv('AWS_SECRET_ACCESS_KEY')
        token = os.getenv('AWS_SESSION_TOKEN', '').strip()
        if token:
            kwargs['aws_session_token'] = token
    return ChatBedrockConverse(**kwargs)
