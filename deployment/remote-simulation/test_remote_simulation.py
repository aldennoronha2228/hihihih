"""Contract tests use a fake manager; they do not execute QEMU."""

import asyncio
import base64
import importlib.util
from pathlib import Path
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.remote_simulation import RemoteSimulationClient, RemoteSimulationError, validate_flash

spec = importlib.util.spec_from_file_location("remote_server", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)
TOKEN = "contract-test-token-" + "x" * 32
HEADERS = {"Authorization": "Bearer " + TOKEN}
FLASH = base64.b64encode(b"merged-test-flash").decode()


class FakeManager:
    def __init__(self, mode="ready"):
        self.mode = mode
        self.live = set()
        self.callbacks = {}
        self.stopped = []
        self.inputs = []

    async def capabilities(self):
        return {board: {"machine": machine, "serial": True, "gpio": False}
                for board, machine in server.BOARDS.items()}

    async def start(self, session_id, board_type, callback, firmware_b64):
        self.callbacks[session_id] = callback
        self.live.add(session_id)
        if self.mode == "error":
            await callback("error", {"message": TOKEN})
        elif self.mode == "raise":
            raise RuntimeError(TOKEN)
        elif self.mode == "scheduled":
            await callback("system", {"event": "booting"})
        else:
            await asyncio.sleep(0.01)
            await callback("system", {"event": "booted"})
            await callback("serial_output", {"data": "hello\n"})

    def running(self, session_id):
        return session_id in self.live

    async def stop(self, session_id):
        self.live.discard(session_id)
        self.stopped.append(session_id)

    async def serial(self, session_id, data):
        self.inputs.append((session_id, data))


def start(client, **changes):
    payload = {"board_id": "esp32-devkit-v1", "firmware_b64": FLASH}
    payload.update(changes)
    return client.post("/sessions", headers=HEADERS, json=payload)


@pytest.mark.parametrize("path,method", [("/health", "get"), ("/capabilities", "get"),
                                            ("/sessions", "post"), ("/sessions/missing", "get"),
                                            ("/sessions/missing/input", "post"), ("/sessions/missing/stop", "post")])
def test_all_routes_require_token(path, method):
    with TestClient(server.create_app(manager=FakeManager(), token=TOKEN)) as client:
        for headers in [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic " + TOKEN}]:
            response = getattr(client, method)(path, headers=headers)
            assert response.status_code == 401
            assert TOKEN not in response.text


def test_health_capabilities_and_results_input_stop():
    manager = FakeManager()
    with TestClient(server.create_app(manager=manager, token=TOKEN)) as client:
        assert client.get("/health", headers=HEADERS).json()["emulator_available"]
        caps = client.get("/capabilities", headers=HEADERS).json()
        assert not caps["gpio_supported"] and not caps["linux_images_supported"]
        response = start(client)
        assert response.status_code == 201
        result = response.json()
        assert result["status"] == "running"
        assert result["serial"] == "hello\n" and result["gpio"] == []
        session_id = result["session_id"]
        empty = client.get(f"/sessions/{session_id}?after={result['cursor']}", headers=HEADERS).json()
        assert empty["events"] == []
        response = client.post(f"/sessions/{session_id}/input", headers=HEADERS,
                               json={"type": "serial", "data_b64": "eA=="})
        assert response.json()["accepted_bytes"] == 1
        assert manager.inputs == [(session_id, b"x")]
        assert client.post(f"/sessions/{session_id}/input", headers=HEADERS,
                           json={"type": "gpio", "pin": 2, "state": 1}).status_code == 422
        assert client.post(f"/sessions/{session_id}/stop", headers=HEADERS, json={}).json()["status"] == "stopped"
        assert client.post(f"/sessions/{session_id}/input", headers=HEADERS,
                           json={"type": "serial", "data_b64": "eA=="}).status_code == 409
        assert client.post(f"/sessions/{session_id}/stop", headers=HEADERS, json={}).status_code == 200
    assert not manager.live


@pytest.mark.parametrize("payload", [{"firmware_b64": "%%%"}, {"firmware_b64": ""},
                                      {"firmware_b64": "é"}, {"firmware_b64": 1},
                                      {"board_id": "raspberry-pi-5"}, {"machine": "arbitrary"},
                                      {"wifi_enabled": True}])
def test_malformed_payload(payload):
    with TestClient(server.create_app(manager=FakeManager(), token=TOKEN)) as client:
        response = start(client, **payload)
        assert response.status_code == 422
        assert FLASH not in response.text
        assert client.post("/sessions", headers=HEADERS, content="{bad").status_code == 422


@pytest.mark.parametrize("mode,status", [("scheduled", 504), ("error", 502), ("raise", 502)])
def test_start_waits_for_actual_ready_and_cleans_failure(mode, status):
    manager = FakeManager(mode)
    with TestClient(server.create_app(manager=manager, token=TOKEN, startup_timeout=0.05)) as client:
        response = start(client)
        assert response.status_code == status
        assert TOKEN not in response.text
        assert not manager.live and manager.stopped
        manager.mode = "ready"
        assert start(client).status_code == 201


def test_capacity_includes_retained_sessions():
    with TestClient(server.create_app(manager=FakeManager(), token=TOKEN, max_sessions=1)) as client:
        session_id = start(client).json()["session_id"]
        assert start(client).status_code == 429
        client.post(f"/sessions/{session_id}/stop", headers=HEADERS, json={})
        assert start(client).status_code == 429
        assert client.get("/sessions/missing", headers=HEADERS).status_code == 404


def test_unavailable_boards_not_advertised():
    manager = FakeManager()
    async def capabilities():
        return {}
    manager.capabilities = capabilities
    with TestClient(server.create_app(manager=manager, token=TOKEN)) as client:
        assert not client.get("/health", headers=HEADERS).json()["emulator_available"]
        assert start(client).status_code == 422


def test_body_size_guard(monkeypatch):
    monkeypatch.setattr(server, "MAX_BODY_BYTES", 128)
    with TestClient(server.create_app(manager=FakeManager(), token=TOKEN)) as client:
        assert client.post("/sessions", headers=HEADERS, content=b"x" * 129).status_code == 413
        assert client.post("/sessions", content=b"x" * 129).status_code == 401


def test_flash_limit():
    maximum = 16 * 1024 * 1024
    validate_flash(base64.b64encode(b"x" * maximum).decode())
    with pytest.raises(ValueError):
        validate_flash(base64.b64encode(b"x" * (maximum + 1)).decode())
    with pytest.raises(Exception) as exc:
        server.decode(base64.b64encode(b"x" * (maximum + 1)).decode(), maximum)
    assert exc.value.status_code == 422


def test_bounded_callback_buffers():
    async def run():
        session = server.Session("a" * 32, "esp32-c3", 0)
        for _ in range(600):
            await session.callback("serial_output", {"data": "x" * 5000})
        result = session.result()
        assert len(result["events"]) == 512 and result["truncated"]
        assert len(result["events"][0]["data"]["data"]) == 4096
    asyncio.run(run())


def test_timeout_cleanup_and_retention():
    async def run():
        manager = FakeManager()
        app = server.create_app(manager=manager, token=TOKEN, session_timeout=1, retention=1)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as client:
                result = (await client.post("/sessions", json={"board_id": "esp32-c3", "firmware_b64": FLASH})).json()
                await asyncio.sleep(1.2)
                assert (await client.get("/sessions/" + result["session_id"])).json()["status"] == "expired"
                assert not manager.live
                await asyncio.sleep(1.1)
                assert (await client.get("/sessions/" + result["session_id"])).status_code == 404
    asyncio.run(run())


@pytest.mark.parametrize("url", ["http://host", "https://user:password@host", "https://host?token=x",
                                 "https://host#fragment", "https://", "https://host:bad", "https://host\\evil"])
def test_gateway_rejects_unsafe_urls(url):
    with pytest.raises(RemoteSimulationError):
        RemoteSimulationClient(url, TOKEN)


def test_missing_configuration(monkeypatch):
    monkeypatch.delenv("REMOTE_SIMULATION_URL", raising=False)
    monkeypatch.delenv("REMOTE_SIMULATION_TOKEN", raising=False)
    with pytest.raises(RemoteSimulationError, match="not configured"):
        RemoteSimulationClient.from_env()


def test_gateway_request_contract():
    calls = []
    def handler(request):
        calls.append(request)
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert request.extensions["timeout"] == {"connect": 5, "read": 30, "write": 30, "pool": 5}
        return httpx.Response(200, json={"status": "ok"})
    async def run():
        async with RemoteSimulationClient("https://configured.example/emulator", TOKEN,
                                          transport=httpx.MockTransport(handler)) as client:
            await client.health()
            await client.capabilities()
            await client.start("esp32-c3", FLASH)
            await client.results("a" * 32, after=7)
            await client.serial_input("a" * 32, b"hello")
            await client.stop("a" * 32)
            with pytest.raises(ValueError):
                await client.stop("https://attacker.example/")
    asyncio.run(run())
    assert [request.method for request in calls] == ["GET", "GET", "POST", "GET", "POST", "POST"]
    assert all(request.url.host == "configured.example" for request in calls)
    assert str(calls[0].url) == "https://configured.example/emulator/health"
    assert calls[3].url.query == b"after=7"


@pytest.mark.parametrize("mode", ["redirect", "error", "timeout", "json"])
def test_gateway_safe_errors_and_no_redirects(mode):
    calls = []
    def handler(request):
        calls.append(request)
        if mode == "timeout":
            raise httpx.ReadTimeout(TOKEN, request=request)
        if mode == "redirect":
            return httpx.Response(302, headers={"Location": "https://attacker.example/"})
        if mode == "error":
            return httpx.Response(500, text=TOKEN)
        return httpx.Response(200, text=TOKEN)
    async def run():
        async with RemoteSimulationClient("https://configured.example", TOKEN,
                                          transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(RemoteSimulationError) as exc:
                await client.health()
            assert TOKEN not in str(exc.value)
    asyncio.run(run())
    assert len(calls) == 1
