import asyncio
from contextlib import aclosing
import time


async def stream_plain_chat(model, history, timeout_seconds=30):
    started = time.perf_counter()
    emitted = False
    try:
        async with asyncio.timeout(timeout_seconds):
            async with aclosing(model.astream(history)) as chunks:
                async for chunk in chunks:
                    text = chunk.content if isinstance(chunk.content, str) else ''.join(block.get('text', '') for block in chunk.content if isinstance(block, dict) and block.get('type') == 'text')
                    if text:
                        emitted = True
                        yield {'type': 'text', 'channel': 'answer', 'text': text}
        if not emitted:
            yield {'type': 'text', 'channel': 'narration', 'text': 'The model returned no answer text. Try another model.'}
        yield {'type': 'done', 'status': 'success' if emitted else 'error', 'elapsedMs': round((time.perf_counter() - started) * 1000)}
    except asyncio.CancelledError:
        raise
    except Exception as error:
        from backend.agent import _provider_error
        yield {'type': 'text', 'channel': 'narration', 'text': _provider_error(error)}
        yield {'type': 'done', 'status': 'error', 'elapsedMs': round((time.perf_counter() - started) * 1000)}
