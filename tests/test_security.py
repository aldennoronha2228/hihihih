import asyncio
import json

import pytest

from backend.security import MAX_BODY_BYTES, SecurityMiddleware


def scope(path='/api/chat', headers=(), kind='http', method='POST'):
    return {'type': kind, 'path': path, 'method': method, 'headers': list(headers)}


async def exchange(app, request=None, chunks=None):
    messages = list(chunks if chunks is not None else [{'type': 'http.request', 'body': b'', 'more_body': False}])
    sent = []

    async def receive():
        if messages:
            return messages.pop(0)
        return {'type': 'http.disconnect'}

    async def send(message):
        sent.append(message)

    await app(request or scope(), receive, send)
    return sent


async def echo(scope, receive, send):
    body = await receive()
    await send({'type': 'http.response.start', 'status': 200,
                'headers': [(b'Cache-Control', b'public'), (b'X-Frame-Options', b'SAMEORIGIN')]})
    await send({'type': 'http.response.body', 'body': body.get('body', b'')})


def run(app, request=None, chunks=None):
    return asyncio.run(exchange(app, request, chunks))


def test_production_requires_token(monkeypatch):
    monkeypatch.setenv('WIREUP_DEPLOYMENT', 'production')
    monkeypatch.delenv('WIREUP_ACCESS_TOKEN', raising=False)
    with pytest.raises(ValueError, match='required in production'):
        SecurityMiddleware(echo)


@pytest.mark.parametrize('setting,value', [
    ('max_body_bytes', 600001), ('max_body_bytes', 0), ('max_concurrent_requests', 0),
    ('max_concurrent_requests', 'oops'), ('allowed_origins', ['*']),
    ('allowed_origins', ['https://example.com/path']), ('allowed_origins', ['https://user:secret@example.com']),
    ('access_token', 'secret\nvalue'), ('public_health', 'perhaps'), ('body_timeout_seconds', 0),
])
def test_invalid_configuration(setting, value):
    with pytest.raises(ValueError):
        SecurityMiddleware(echo, production=False, **{setting: value})


def test_env_configuration(monkeypatch):
    monkeypatch.setenv('WIREUP_DEPLOYMENT', 'production')
    monkeypatch.setenv('WIREUP_ACCESS_TOKEN', 'not-a-real-secret')
    monkeypatch.setenv('WIREUP_ALLOWED_ORIGINS', 'https://example.com, https://other.example:8443')
    monkeypatch.setenv('WIREUP_MAX_CONCURRENT_REQUESTS', '2')
    monkeypatch.setenv('WIREUP_MAX_BODY_BYTES', '100')
    monkeypatch.setenv('WIREUP_PUBLIC_HEALTH', 'false')
    middleware = SecurityMiddleware(echo)
    assert middleware.max_body_bytes == 100
    assert middleware.max_concurrent_requests == 2
    assert middleware.public_health is False
    assert middleware.public_status() == {'production': True, 'authentication_required': True}
    assert 'not-a-real-secret' not in json.dumps(middleware.public_status())


@pytest.mark.parametrize('path', ['/api/chat', '/api/hardware/projects', '/api/health',
                                  '/docs', '/docs/private', '/redoc', '/openapi.json', '/docs/oauth2-redirect'])
def test_auth_covers_api_and_docs(path):
    middleware = SecurityMiddleware(echo, production=True, access_token='test-token', public_health=False)
    response = run(middleware, scope(path, method='GET'))
    assert response[0]['status'] == 401
    assert dict(response[0]['headers'])[b'www-authenticate'] == b'Bearer'
    assert b'test-token' not in response[-1]['body']
    assert run(middleware, scope(path, [(b'authorization', b'Bearer test-token')]))[0]['status'] == 200


@pytest.mark.parametrize('headers', [[], [(b'authorization', b'Bearer wrong')],
    [(b'authorization', b'Basic test-token')], [(b'authorization', b'Bearer  test-token')],
    [(b'authorization', b'Bearer test-token'), (b'authorization', b'Bearer test-token')]])
def test_bad_auth_and_query_token_not_accepted(headers):
    middleware = SecurityMiddleware(echo, production=True, access_token='test-token')
    request = {**scope(headers=headers), 'query_string': b'token=test-token'}
    assert run(middleware, request)[0]['status'] == 401


def test_optional_auth_and_local_limits():
    middleware = SecurityMiddleware(echo, production=False, access_token='')
    assert run(middleware)[0]['status'] == 200
    middleware = SecurityMiddleware(echo, production=False, access_token='test-token')
    assert run(middleware)[0]['status'] == 401


@pytest.mark.parametrize('origin,status', [
    ('http://localhost:5173', 200), ('http://127.0.0.1:5173', 200), ('http://[::1]:5173', 200),
    ('https://deploy.example', 200), ('https://deploy.example:443', 200),
    ('https://evil.example', 403), ('https://deploy.example.evil', 403),
    ('https://deploy.example/path', 403), ('null', 403), ('file://localhost', 403),
    ('https://user@deploy.example', 403), ('http://deploy.example', 403),
    ('https://deploy.example\n', 403),
])
def test_exact_origin_allowlist(origin, status):
    middleware = SecurityMiddleware(echo, production=True, access_token='test-token',
                                    allowed_origins=['https://deploy.example'])
    response = run(middleware, scope(headers=[(b'origin', origin.encode()), (b'authorization', b'Bearer test-token')]))
    assert response[0]['status'] == status


def test_no_origin_is_allowed_with_auth_but_duplicates_are_rejected():
    middleware = SecurityMiddleware(echo, production=True, access_token='test-token')
    assert run(middleware, scope(headers=[(b'authorization', b'Bearer test-token')]))[0]['status'] == 200
    assert run(middleware, scope(headers=[(b'origin', b'http://localhost'), (b'origin', b'http://localhost')]))[0]['status'] == 403


def test_public_health_is_minimal_and_does_not_call_provider_health():
    async def unsafe_app(scope, receive, send):
        raise AssertionError('Health must not expose provider configuration.')

    middleware = SecurityMiddleware(unsafe_app, production=True, access_token='test-token')
    response = run(middleware, scope('/api/health', method='GET'))
    assert response[0]['status'] == 200
    assert json.loads(response[-1]['body']) == {
        'status': 'ok', 'security': {'production': True, 'authentication_required': True}}
    assert b'test-token' not in response[-1]['body']
    assert run(middleware, scope('/api/health', method='HEAD'))[-1]['body'] == b''
    assert run(middleware, scope('/api/health', method='POST'))[0]['status'] == 401
    assert run(middleware, scope('/api/health/other', method='GET'))[0]['status'] == 401


@pytest.mark.parametrize('headers,chunks,status', [
    ([(b'content-length', b'600001')], [], 413),
    ([], [{'type': 'http.request', 'body': b'x' * 300000, 'more_body': True},
          {'type': 'http.request', 'body': b'x' * 300001}], 413),
    ([(b'transfer-encoding', b'chunked')], [{'type': 'http.request', 'body': b'x' * 600001}], 413),
    ([(b'content-length', b'2')], [{'type': 'http.request', 'body': b'xxx'}], 400),
    ([(b'content-length', b'-1')], [], 400),
    ([(b'content-length', b'0'), (b'content-length', b'0')], [], 400),
    ([(b'content-length', b'0'), (b'transfer-encoding', b'chunked')], [], 400),
    ([(b'content-length', b'9' * 10000)], [], 400),
])
def test_rejected_bodies_never_reach_routes(headers, chunks, status):
    async def unreachable(scope, receive, send):
        raise AssertionError('Invalid body must not reach the route.')

    response = run(SecurityMiddleware(unreachable, production=False), scope(headers=headers), chunks)
    assert response[0]['status'] == status
    assert dict(response[0]['headers'])[b'cache-control'] == b'no-store'


def test_exact_limit_and_chunked_replay():
    body = b'x' * MAX_BODY_BYTES
    middleware = SecurityMiddleware(echo, production=False)
    response = run(middleware, scope(headers=[(b'content-length', str(len(body)).encode())]),
                   [{'type': 'http.request', 'body': body}])
    assert response[0]['status'] == 200
    assert response[-1]['body'] == body
    response = run(middleware, scope(headers=[(b'transfer-encoding', b'chunked')]),
                   [{'type': 'http.request', 'body': body[:200000], 'more_body': True},
                    {'type': 'http.request', 'body': body[200000:]}])
    assert response[-1]['body'] == body


def test_headers_replace_existing_case_insensitively():
    response = run(SecurityMiddleware(echo, production=False))
    headers = dict(response[0]['headers'])
    assert headers[b'cache-control'] == b'no-store'
    assert headers[b'x-frame-options'] == b'DENY'
    assert headers[b'x-content-type-options'] == b'nosniff'
    assert headers[b'referrer-policy'] == b'no-referrer'
    assert b'Cache-Control' not in headers


def test_trusted_marker_does_not_mutate_input_scope():
    original = scope(headers=[(b'authorization', b'Bearer test-token')])

    async def checked(scope, receive, send):
        assert scope['wireup.security']['authenticated'] is True
        assert scope['wireup.security']['production'] is True
        assert scope['wireup.security']['origin_present'] is False
        assert 'state' not in scope
        await echo(scope, receive, send)

    run(SecurityMiddleware(checked, production=True, access_token='test-token'), original)
    assert 'wireup.security' not in original


@pytest.mark.parametrize('path', ['/api/chat', '/api/chat/stream', '/api/compiler/compile',
                                  '/api/hardware/project/test/command', '/api/hardware/project/test/compile'])
def test_concurrency_cap_covers_stream_lifetime_and_leaves_health_available(path):
    async def scenario():
        started = asyncio.Event()
        finish = asyncio.Event()

        async def stream(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            started.set()
            await finish.wait()
            await send({'type': 'http.response.body', 'body': b'done'})

        middleware = SecurityMiddleware(stream, production=True, access_token='test-token', max_concurrent_requests=1)
        request = scope(path, [(b'authorization', b'Bearer test-token')])
        first = asyncio.create_task(exchange(middleware, request))
        await started.wait()
        assert (await exchange(middleware, request))[0]['status'] == 429
        assert (await exchange(middleware, scope('/api/health', method='GET')))[0]['status'] == 200
        finish.set()
        await first
        assert (await exchange(middleware, request))[0]['status'] == 200

    asyncio.run(scenario())


@pytest.mark.parametrize('failure', ['exception', 'cancel', 'disconnect', 'body'])
def test_concurrency_slot_released_on_failures(failure):
    async def scenario():
        entered = asyncio.Event()

        async def app(scope, receive, send):
            entered.set()
            if failure == 'exception':
                raise RuntimeError('route failed')
            if failure == 'cancel':
                await asyncio.Event().wait()
            await echo(scope, receive, send)

        middleware = SecurityMiddleware(app, production=False, max_concurrent_requests=1)
        if failure == 'exception':
            with pytest.raises(RuntimeError):
                await exchange(middleware)
        elif failure == 'cancel':
            task = asyncio.create_task(exchange(middleware))
            await entered.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        elif failure == 'disconnect':
            await exchange(middleware, chunks=[{'type': 'http.disconnect'}])
        else:
            await exchange(middleware, chunks=[{'type': 'http.request', 'body': b'x' * 600001}])
        middleware.app = echo
        assert (await exchange(middleware))[0]['status'] == 200

    asyncio.run(scenario())


def test_upload_holds_budget_and_unrelated_api_bypasses_it():
    async def scenario():
        uploading = asyncio.Event()
        finish = asyncio.Event()

        async def slow_receive():
            uploading.set()
            await finish.wait()
            return {'type': 'http.request', 'body': b''}

        async def discard(message):
            pass

        middleware = SecurityMiddleware(echo, production=False, max_concurrent_requests=1)
        first = asyncio.create_task(middleware(scope(), slow_receive, discard))
        await uploading.wait()
        assert (await exchange(middleware))[0]['status'] == 429
        assert (await exchange(middleware, scope('/api/hardware/catalog', method='GET')))[0]['status'] == 200
        finish.set()
        await first
        assert (await exchange(middleware))[0]['status'] == 200

    asyncio.run(scenario())


def test_disconnect_is_forwarded_after_body_replay():
    async def checked(scope, receive, send):
        assert (await receive())['body'] == b'hello'
        assert (await receive())['type'] == 'http.disconnect'
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b''})

    response = run(SecurityMiddleware(checked, production=False), chunks=[
        {'type': 'http.request', 'body': b'hello'}, {'type': 'http.disconnect'}])
    assert response[0]['status'] == 200


def test_body_timeout(monkeypatch):
    class ImmediateTimeout:
        async def __aenter__(self):
            raise TimeoutError()

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr('backend.security.asyncio.timeout', lambda value: ImmediateTimeout())
    assert run(SecurityMiddleware(echo, production=False))[0]['status'] == 408


def test_websocket_auth_and_origin_guard_and_lifespan_passthrough():
    async def websocket(scope, receive, send):
        assert scope['wireup.security']['authenticated'] is True
        await send({'type': 'websocket.accept'})
        await send({'type': 'websocket.close', 'code': 1000})

    middleware = SecurityMiddleware(websocket, production=True, access_token='test-token',
                                    allowed_origins=['https://deploy.example'])
    request = scope('/api/hardware/project/test/runtime', kind='websocket')
    assert run(middleware, request)[0] == {'type': 'websocket.close', 'code': 4401}
    request['headers'] = [(b'authorization', b'Bearer test-token'), (b'origin', b'https://evil.example')]
    assert run(middleware, request)[0] == {'type': 'websocket.close', 'code': 4403}
    request['headers'][1] = (b'origin', b'https://deploy.example')
    assert run(middleware, request)[0]['type'] == 'websocket.accept'

    async def lifespan(scope, receive, send):
        assert scope['type'] == 'lifespan'
        await send({'type': 'lifespan.startup.complete'})

    middleware.app = lifespan
    assert run(middleware, {'type': 'lifespan'}) == [{'type': 'lifespan.startup.complete'}]
