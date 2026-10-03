import os

from langchain.chat_models import init_chat_model
from langchain_openai import ChatOpenAI

NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'


def model_options():
    return [
        {'id': 'groq', 'label': 'Groq', 'model': os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b'), 'configured': bool(os.getenv('GROQ_API_KEY', '').strip())},
        {'id': 'nvidia', 'label': 'NVIDIA', 'model': os.getenv('NVIDIA_MODEL', 'z-ai/glm-5.3'), 'configured': bool(os.getenv('NVIDIA_API_KEY', '').strip())},
    ]


def build_model(provider, key, model_name):
    if provider == 'nvidia':
        return ChatOpenAI(model=model_name, api_key=key, base_url=NVIDIA_BASE_URL,
                          temperature=0.5, max_retries=0, timeout=20, streaming=True,
                          max_tokens=2048,
                          stream_usage=False)
    options = {}
    if model_name in ('openai/gpt-oss-120b', 'openai/gpt-oss-20b'):
        options = {'model_kwargs': {'include_reasoning': True}}
    elif model_name.startswith('qwen/'):
        options = {'reasoning_format': 'parsed'}
    return init_chat_model(model_name, model_provider='groq', api_key=key,
                           temperature=0.5, max_retries=0, timeout=20, max_tokens=1024, **options)
