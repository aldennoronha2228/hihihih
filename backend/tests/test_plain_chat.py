import asyncio
from langchain_core.messages import AIMessageChunk, HumanMessage
from backend.plain_chat import stream_plain_chat


def test_plain_answer_arrives_before_model_finishes():
    class Model:
        async def astream(self, history):
            yield AIMessageChunk(content='Hello')
            yield AIMessageChunk(content=' world')
    async def run():
        return [item async for item in stream_plain_chat(Model(), [HumanMessage(content='Hi')])]
    events = asyncio.run(run())
    assert [item.get('text') for item in events[:-1]] == ['Hello', ' world']
    assert events[-1]['status'] == 'success'


def test_plain_quota_error_has_no_retry_wait():
    class QuotaError(Exception):
        status_code = 429
    class Model:
        async def astream(self, history):
            raise QuotaError()
            yield
    async def run():
        return [item async for item in stream_plain_chat(Model(), [HumanMessage(content='Hi')])]
    events = asyncio.run(run())
    assert 'rate limit' in events[0]['text']
    assert events[-1]['status'] == 'error'
