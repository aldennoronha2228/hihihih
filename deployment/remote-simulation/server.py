"""Bounded standalone gateway for the pinned upstream EspQemuManager."""

import asyncio
import base64
import binascii
from collections import deque
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
import hmac
import os
import re
import shutil
import time
import uuid

from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from typing import Literal

UPSTREAM_REVISION = "3e45cada3f362ce61fe2c8515f7fee0f7acf4113"
MAX_FLASH_BYTES = 16 * 1024 * 1024
MAX_BODY_BYTES = 4 * ((MAX_FLASH_BYTES + 2) // 3) + 1024
BOARDS = {
    "esp32-devkit-v1": "esp32",
    "esp32-devkit-c-v4": "esp32",
    "esp32-s3": "esp32-s3",
    "esp32-c3": "esp32-c3",
}


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartPayload(Payload):
    board_id: Literal["esp32-devkit-v1", "esp32-devkit-c-v4", "esp32-s3", "esp32-c3"]
    firmware_b64: StrictStr = Field(min_length=1, max_length=MAX_BODY_BYTES - 1024)


class InputPayload(Payload):
    type: Literal["serial"]
    data_b64: StrictStr = Field(min_length=1, max_length=5464)


def decode(data, maximum):
    try:
        result = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "Invalid base64") from None
    if not 1 <= len(result) <= maximum:
        raise HTTPException(422, "Decoded data size is out of range")
    return result


class UpstreamManager:
    """Private lifecycle access is tied to UPSTREAM_REVISION."""

    def __init__(self):
        from app.services.esp_qemu_manager import EspInstance, EspQemuManager, _MACHINE
        self.manager = EspQemuManager()
        self.instance_class = EspInstance
        self.machines = _MACHINE
        self.boots = {}
        self.instances = {}

    async def capabilities(self):
        supported = {}
        probes = {}
        for board_id, board_type in BOARDS.items():
            binary, machine = self.machines[board_type]
            if binary not in probes:
                executable = shutil.which(binary)
                names = set()
                if executable:
                    process = None
                    try:
                        process = await asyncio.create_subprocess_exec(
                            executable, "-machine", "help", stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        output, _ = await asyncio.wait_for(process.communicate(), 5)
                        if process.returncode == 0:
                            names = {line.split()[0] for line in output.decode(errors="replace").splitlines() if line.split()}
                    except (OSError, asyncio.TimeoutError):
                        pass
                    finally:
                        if process and process.returncode is None:
                            with suppress(ProcessLookupError):
                                process.kill()
                            await process.wait()
                probes[binary] = names
            if machine in probes[binary]:
                supported[board_id] = {"machine": machine, "serial": True, "gpio": False}
        return supported

    async def start(self, session_id, board_type, callback, firmware_b64):
        inst = self.instance_class(session_id, board_type, callback)
        self.manager._instances[session_id] = inst
        self.instances[session_id] = inst
        task = asyncio.create_task(self.manager._boot(inst, firmware_b64, False, 0))
        self.boots[session_id] = task
        await task

    def running(self, session_id):
        inst = self.manager._instances.get(session_id)
        return bool(inst and inst.running and inst.process and inst.process.returncode is None and inst._serial_writer)

    async def stop(self, session_id):
        task = self.boots.pop(session_id, None)
        if task:
            if not task.done():
                task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        self.manager._instances.pop(session_id, None)
        inst = self.instances.pop(session_id, None)
        if inst:
            process = inst.process
            tasks = list(inst._tasks)
            writers = [inst._serial_writer, inst._gpio_writer]
            try:
                await self.manager._shutdown(inst)
            finally:
                for child in tasks:
                    child.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                for writer in writers:
                    if writer:
                        writer.close()
                        with suppress(Exception):
                            await asyncio.wait_for(writer.wait_closed(), 1)
                if process and process.returncode is None:
                    with suppress(ProcessLookupError):
                        process.kill()
                    await process.wait()
                if inst.firmware_path:
                    with suppress(FileNotFoundError):
                        os.unlink(inst.firmware_path)

    async def serial(self, session_id, data):
        if not self.running(session_id):
            raise HTTPException(409, "Session is not running")
        await self.manager.send_serial_bytes(session_id, data)


@dataclass
class Session:
    id: str
    board_id: str
    created: float
    state: str = "starting"
    sequence: int = 0
    events: deque = field(default_factory=lambda: deque(maxlen=512))
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    cleaned: bool = False

    async def callback(self, event_type, data):
        if self.state in {"stopped", "expired", "failed", "exited"}:
            return
        if event_type == "serial_output":
            data = {"data": str(data.get("data", ""))[:4096]}
        elif event_type == "gpio_change":
            data = {"pin": data.get("pin"), "state": data.get("state")}
        elif event_type == "system":
            data = {"event": str(data.get("event", ""))[:64]}
        elif event_type == "error":
            data = {"message": "Emulator reported an error"}
        else:
            return
        self.sequence += 1
        self.events.append({"sequence": self.sequence, "type": event_type, "data": data})
        if event_type == "system" and data.get("event") == "booted":
            self.state = "running"
            self.ready.set()
        elif event_type == "error" or (event_type == "system" and data.get("event") == "exited"):
            self.state = "failed" if self.state == "starting" else "exited"
            self.ready.set()

    def result(self, after=0):
        events = [event for event in self.events if event["sequence"] > after]
        return {
            "session_id": self.id, "board_id": self.board_id, "status": self.state,
            "cursor": self.sequence, "events": events,
            "truncated": bool(self.events and after < self.events[0]["sequence"] - 1),
            "serial": "".join(event["data"]["data"] for event in events if event["type"] == "serial_output"),
            "gpio": [event["data"] for event in events if event["type"] == "gpio_change"],
        }


class RequestGuard:
    def __init__(self, app, token):
        self.app = app
        self.expected = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = scope.get("headers", [])
        authorization = [value for key, value in headers if key.lower() == b"authorization"]
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0], self.expected):
            return await JSONResponse({"detail": "Unauthorized"}, 401, headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                return await JSONResponse({"detail": "Request body too large"}, 413)(scope, receive, send)
            if not message.get("more_body", False):
                break
        async def replay():
            return {"type": "http.request", "body": bytes(body), "more_body": False}
        await self.app(scope, replay, send)


def create_app(*, manager=None, token=None, max_sessions=4, session_timeout=300,
               startup_timeout=20, retention=60):
    token = token if token is not None else os.environ.get("REMOTE_SIMULATION_TOKEN", "")
    if not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{32,}", token):
        raise RuntimeError("REMOTE_SIMULATION_TOKEN must be at least 32 printable non-whitespace ASCII characters")
    if not 1 <= max_sessions <= 16 or not 1 <= session_timeout <= 3600 or not 0 < startup_timeout <= 25 or not 1 <= retention <= 300:
        raise ValueError("Invalid session limits")
    sessions = {}
    capacity = asyncio.Lock()
    capabilities = {}

    async def stop(session, state):
        async with session.lock:
            session.state = state
            if not session.cleaned:
                await manager.stop(session.id)
                session.cleaned = True

    async def sweep():
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            for session in list(sessions.values()):
                age = now - session.created
                if session.state == "running" and not manager.running(session.id):
                    await stop(session, "exited")
                if age >= session_timeout and session.state not in {"stopped", "expired", "failed", "exited"}:
                    await stop(session, "expired")
                if session.state in {"stopped", "expired", "failed", "exited"} and not session.cleaned:
                    await stop(session, session.state)
                if age >= session_timeout + retention:
                    await stop(session, session.state)
                    sessions.pop(session.id, None)

    @asynccontextmanager
    async def lifespan(app):
        nonlocal manager
        manager = manager if manager is not None else UpstreamManager()
        capabilities.update(await manager.capabilities())
        worker = asyncio.create_task(sweep())
        try:
            yield
        finally:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
            for session in list(sessions.values()):
                await stop(session, "stopped")
            sessions.clear()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestGuard, token=token)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse({"detail": "Invalid request payload"}, 422)

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return JSONResponse({"detail": "Remote emulator operation failed"}, 500)

    def find(session_id: str):
        session = sessions.get(session_id)
        if not session:
            raise HTTPException(404, "Session not found")
        return session

    @app.get("/health")
    async def health():
        return {"status": "ok", "emulator_available": bool(capabilities), "upstream_revision": UPSTREAM_REVISION}

    @app.get("/capabilities")
    async def get_capabilities():
        return {"boards": capabilities, "max_flash_bytes": MAX_FLASH_BYTES,
                "max_sessions": max_sessions, "session_timeout_seconds": session_timeout,
                "gpio_supported": False, "linux_images_supported": False, "websocket_events": False}

    @app.post("/sessions", status_code=201)
    async def start(payload: StartPayload):
        decode(payload.firmware_b64, MAX_FLASH_BYTES)
        if payload.board_id not in capabilities:
            raise HTTPException(422, "Board machine is not available on this server")
        async with capacity:
            if len(sessions) >= max_sessions:
                raise HTTPException(429, "Session capacity reached; retained sessions also count")
            session = Session(uuid.uuid4().hex, payload.board_id, time.monotonic())
            sessions[session.id] = session
        try:
            async with session.lock:
                async def boot():
                    await manager.start(session.id, BOARDS[payload.board_id], session.callback, payload.firmware_b64)
                    await session.ready.wait()
                    if session.state != "running" or not manager.running(session.id):
                        raise RuntimeError("Emulator did not become ready")
                await asyncio.wait_for(boot(), min(startup_timeout, session_timeout))
            return session.result()
        except BaseException as exc:
            await stop(session, "failed")
            sessions.pop(session.id, None)
            if isinstance(exc, asyncio.CancelledError):
                raise
            if isinstance(exc, asyncio.TimeoutError):
                raise HTTPException(504, "Emulator startup timed out") from None
            raise HTTPException(502, "Emulator failed to start") from None

    @app.get("/sessions/{session_id}")
    async def results(session_id: str, after: int = Query(default=0, ge=0)):
        return find(session_id).result(after)

    @app.post("/sessions/{session_id}/stop")
    async def stop_session(session_id: str, payload: Payload):
        session = find(session_id)
        await stop(session, "stopped")
        return session.result()

    @app.post("/sessions/{session_id}/input")
    async def input_session(session_id: str, payload: InputPayload):
        data = decode(payload.data_b64, 4096)
        session = find(session_id)
        async with session.lock:
            if session.state != "running" or not manager.running(session_id):
                raise HTTPException(409, "Session is not running")
            try:
                await asyncio.wait_for(manager.serial(session_id, data), 5)
            except asyncio.TimeoutError:
                raise HTTPException(504, "Serial input timed out") from None
            except Exception:
                raise HTTPException(502, "Serial input failed") from None
        return {"session_id": session_id, "accepted_bytes": len(data)}

    return app
