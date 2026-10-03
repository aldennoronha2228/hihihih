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


@pytest.mark.parametrize("token", [None, "short", "x" * 32 + "é", "x" * 32 + "\n", "x" * 32 + "\x7f"])
def test_invalid_tokens_rejected(token):
    with pytest.raises(RemoteSimulationError):
        RemoteSimulationClient("https://configured.example", token)
    if token is not None:
        with pytest.raises(RuntimeError):
            server.create_app(manager=FakeManager(), token=token)


def test_duplicate_auth_and_no_public_documentation():
    with TestClient(server.create_app(manager=FakeManager(), token=TOKEN)) as client:
        duplicate = [("Authorization", "Bearer " + TOKEN)] * 2
        assert client.get("/health", headers=duplicate).status_code == 401
        assert client.get("/docs", headers=HEADERS).status_code == 404
        assert client.get("/openapi.json", headers=HEADERS).status_code == 404


def test_client_server_end_to_end_and_close():
    async def run():
        manager = FakeManager()
        app = server.create_app(manager=manager, token=TOKEN)
        async with app.router.lifespan_context(app):
            client = RemoteSimulationClient("https://configured.example", TOKEN,
                                            transport=httpx.ASGITransport(app=app))
            async with client:
                assert (await client.capabilities())["boards"]["esp32-c3"]["serial"]
                result = await client.start("esp32-c3", FLASH)
                session_id = result["session_id"]
                assert (await client.read(session_id))["serial"] == "hello\n"
                assert (await client.results(session_id, after=result["cursor"]))["events"] == []
                await client.serial_input(session_id, b"test")
                assert (await client.stop(session_id))["status"] == "stopped"
            assert client._client.is_closed
            assert manager.inputs == [(session_id, b"test")]
        assert not manager.live
        assert manager.stopped.count(session_id) == 1
    asyncio.run(run())


def test_cancelled_start_cleans_session():
    async def run():
        manager = FakeManager("scheduled")
        app = server.create_app(manager=manager, token=TOKEN, max_sessions=1)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test", headers=HEADERS) as client:
                task = asyncio.create_task(client.post("/sessions", json={"board_id": "esp32-c3", "firmware_b64": FLASH}))
                await asyncio.sleep(0.02)
                assert manager.live
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert not manager.live and manager.stopped
                manager.mode = "ready"
                assert (await client.post("/sessions", json={"board_id": "esp32-c3", "firmware_b64": FLASH})).status_code == 201
        assert not manager.live
    asyncio.run(run())


@pytest.mark.parametrize("event,data,state", [("system", {"event": "exited"}, "exited"),
                                               ("error", {"message": TOKEN}, "exited")])
def test_terminal_callback_triggers_prompt_cleanup(event, data, state):
    async def run():
        manager = FakeManager()
        app = server.create_app(manager=manager, token=TOKEN)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test", headers=HEADERS) as client:
                result = (await client.post("/sessions", json={"board_id": "esp32-c3", "firmware_b64": FLASH})).json()
                session_id = result["session_id"]
                await manager.callbacks[session_id](event, data)
                await asyncio.sleep(1.1)
                assert session_id not in manager.live
                response = await client.get("/sessions/" + session_id)
                assert response.json()["status"] == state
                assert TOKEN not in response.text
    asyncio.run(run())


def test_ignored_events_do_not_advance_cursor():
    async def run():
        session = server.Session("a" * 32, "esp32-c3", 0)
        await session.callback("wifi_status", {"status": "connected"})
        assert session.result()["cursor"] == 0
        await session.callback("system", {"event": "exited"})
        await session.callback("serial_output", {"data": "late"})
        assert session.result()["cursor"] == 1
        assert session.result()["serial"] == ""
    asyncio.run(run())


def test_upstream_adapter_tracks_orphan_and_reaps_cleanup(tmp_path):
    async def run():
        adapter = server.UpstreamManager.__new__(server.UpstreamManager)
        class Process:
            returncode = None
            killed = False
            waited = False
            def kill(self):
                self.killed = True
            async def wait(self):
                self.waited = True
                self.returncode = -9
        class Writer:
            closed = False
            waited = False
            def close(self):
                self.closed = True
            async def wait_closed(self):
                self.waited = True
        class Instance:
            def __init__(self, session_id, board_type, callback):
                self.process = Process()
                self._serial_writer = Writer()
                self._gpio_writer = None
                self._tasks = [asyncio.create_task(asyncio.Event().wait())]
                self.firmware_path = str(tmp_path / "flash.bin")
                Path(self.firmware_path).write_bytes(b"flash")
                self.running = True
        class Manager:
            def __init__(self):
                self._instances = {}
                self.instance = None
            async def _boot(self, inst, firmware, wifi, forwarding):
                assert not wifi and forwarding == 0
                self.instance = inst
                self._instances.clear()
                raise RuntimeError("upstream removed its failed instance")
            async def _shutdown(self, inst):
                inst._tasks.clear()
        adapter.manager = Manager()
        adapter.instance_class = Instance
        adapter.boots = {}
        adapter.instances = {}
        with pytest.raises(RuntimeError):
            await adapter.start("a" * 32, "esp32-c3", None, FLASH)
        inst = adapter.manager.instance
        tasks = list(inst._tasks)
        await adapter.stop("a" * 32)
        assert inst.process.killed and inst.process.waited
        assert inst._serial_writer.closed and inst._serial_writer.waited
        assert all(task.done() for task in tasks)
        assert not Path(inst.firmware_path).exists()
        assert not adapter.instances and not adapter.boots
        await adapter.stop("a" * 32)
    asyncio.run(run())


def test_smoke_start_read_stop_and_failure_cleanup(tmp_path):
    smoke_spec = importlib.util.spec_from_file_location("remote_smoke", Path(__file__).with_name("smoke.py"))
    smoke = importlib.util.module_from_spec(smoke_spec)
    smoke_spec.loader.exec_module(smoke)
    from argparse import Namespace
    firmware = tmp_path / "merged.bin"
    firmware.write_bytes(b"flash")
    async def run():
        manager = FakeManager()
        app = server.create_app(manager=manager, token=TOKEN)
        async with app.router.lifespan_context(app):
            def factory():
                return RemoteSimulationClient("https://configured.example", TOKEN,
                                              transport=httpx.ASGITransport(app=app))
            args = Namespace(board="esp32-c3", firmware=firmware, seconds=0.01, expect_serial="hello")
            await smoke.check(args, client_factory=factory)
            assert not manager.live
            args.expect_serial = "missing-marker"
            with pytest.raises(RemoteSimulationError):
                await smoke.check(args, client_factory=factory)
            assert not manager.live
    asyncio.run(run())


def test_machine_probe_advertises_only_native_support(monkeypatch):
    async def run():
        adapter = server.UpstreamManager.__new__(server.UpstreamManager)
        adapter.machines = {"esp32": ("xtensa", "esp32"), "esp32-s3": ("xtensa", "esp32s3"),
                            "esp32-c3": ("riscv32", "esp32c3")}
        calls = []
        class Probe:
            returncode = None
            async def communicate(self):
                self.returncode = 0
                return b"Supported machines:\nesp32 test machine\n", b""
        async def subprocess(*args, **kwargs):
            calls.append(args)
            return Probe()
        monkeypatch.setattr(server.shutil, "which", lambda binary: "/fake/xtensa" if binary == "xtensa" else None)
        monkeypatch.setattr(server.asyncio, "create_subprocess_exec", subprocess)
        capabilities = await adapter.capabilities()
        assert set(capabilities) == {"esp32-devkit-v1", "esp32-devkit-c-v4"}
        assert len(calls) == 1
        assert calls[0] == ("/fake/xtensa", "-machine", "help")
    asyncio.run(run())


def test_start_budget_never_exceeds_absolute_ttl():
    manager = FakeManager("scheduled")
    with TestClient(server.create_app(manager=manager, token=TOKEN, session_timeout=1, startup_timeout=20)) as client:
        response = start(client)
        assert response.status_code == 504
        assert not manager.live


def test_serial_failure_is_sanitized():
    manager = FakeManager()
    async def serial(session_id, data):
        raise RuntimeError(TOKEN)
    manager.serial = serial
    with TestClient(server.create_app(manager=manager, token=TOKEN)) as client:
        session_id = start(client).json()["session_id"]
        response = client.post(f"/sessions/{session_id}/input", headers=HEADERS,
                               json={"type": "serial", "data_b64": "eA=="})
        assert response.status_code == 502 and TOKEN not in response.text


def test_upstream_hashes_and_docker_copy_inputs():
    import hashlib
    for line in Path(__file__).with_name("upstream.sha256").read_text().splitlines():
        expected, name = line.split()
        source = ROOT / "vendor" / "velxio" / name
        assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
    dockerfile = Path(__file__).with_name("Dockerfile").read_text()
    for line in dockerfile.splitlines():
        if line.startswith("COPY ") and "--from=" not in line:
            for name in line.split()[1:-1]:
                assert (ROOT / name).is_file(), name
