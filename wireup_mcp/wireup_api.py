"""Thin HTTP client for the running WireUp backend.

This module only speaks to WireUp's existing REST surface
(``/api/hardware`` and ``/api/hardware/samples``). It never imports
``backend.*``, so the MCP server shares no state, no locks, and no
project files with the FastAPI process. Every mutation still goes through
``HardwareService.command()`` on the server side, which means the
feasibility gate, revision checks, and approval state machine all keep
applying exactly as they do for the web UI and the in-app agent.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]


def _load_env_file() -> dict[str, str]:
    """Minimal .env reader so the MCP picks up BACKEND_PORT/token like the app does."""
    values: dict[str, str] = {}
    env_path = ROOT / '.env'
    if not env_path.is_file():
        return values
    for raw in env_path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        values[key.strip()] = value
    return values


_ENV = _load_env_file()


def _setting(key: str, default: str | None = None) -> str | None:
    """Process env wins over .env, matching backend/app.py's reload_settings behaviour."""
    return os.environ.get(key) or _ENV.get(key) or default


def base_url() -> str:
    port = _setting('BACKEND_PORT', '8000')
    return _setting('WIREUP_API_BASE', f'http://127.0.0.1:{port}').rstrip('/')


def access_token() -> str | None:
    """Only sent when deployment mode is production, matching SecurityMiddleware."""
    if _setting('WIREUP_DEPLOYMENT') != 'production':
        return None
    return _setting('WIREUP_ACCESS_TOKEN')


class WireUpError(RuntimeError):
    """Raised for any non-2xx response; carries the server's own message."""


def _headers() -> dict[str, str]:
    headers = {'Accept': 'application/json'}
    token = access_token()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


_TIMEOUT = httpx.Timeout(300.0, connect=5.0)


async def request(method: str, path: str, **kwargs: Any) -> Any:
    url = f'{base_url()}{path}'
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        try:
            response = await client.request(method, url, headers=_headers(), **kwargs)
        except httpx.ConnectError as exc:
            raise WireUpError(
                f'Could not reach the WireUp backend at {base_url()}. '
                'Start it with `npm run dev:api` (or `npm run dev`).'
            ) from exc
        except httpx.TimeoutException as exc:
            raise WireUpError(f'WireUp backend timed out on {method} {path}.') from exc

    if response.status_code >= 400:
        detail = response.text.strip()
        try:
            payload = response.json()
            detail = payload.get('detail', detail) if isinstance(payload, dict) else detail
        except ValueError:
            pass
        raise WireUpError(f'{response.status_code} on {method} {path}: {detail[:800]}')

    if response.headers.get('content-type', '').startswith('application/json'):
        return response.json()
    return response.text


async def health() -> Any:
    return await request('GET', '/api/health')


async def list_projects() -> Any:
    return await request('GET', '/api/hardware/projects')


async def get_project(project_id: str) -> Any:
    return await request('GET', f'/api/hardware/projects/{project_id}')


async def create_project(name: str, board: str = 'unselected') -> Any:
    return await request('POST', '/api/hardware/projects', json={'name': name, 'board': board})


async def delete_project(project_id: str) -> Any:
    return await request('DELETE', f'/api/hardware/projects/{project_id}')


async def catalog(query: str = '', limit: int = 50) -> Any:
    return await request('GET', '/api/hardware/catalog', params={'q': query, 'limit': limit})


async def list_samples() -> Any:
    return await request('GET', '/api/hardware/samples/all')


async def open_sample(sample_id: str) -> Any:
    return await request('POST', f'/api/hardware/samples/{sample_id}/open')


async def command(project_id: str, name: str, args: dict[str, Any] | None = None,
                  runtime_token: str | None = None) -> Any:
    payload: dict[str, Any] = {'name': name, 'args': args or {}}
    if runtime_token:
        payload['runtime_token'] = runtime_token
    return await request('POST', f'/api/hardware/project/{project_id}/command', json=payload)


async def artifact(project_id: str, artifact_id: str) -> Any:
    return await request('GET', f'/api/hardware/project/{project_id}/artifacts/{artifact_id}')