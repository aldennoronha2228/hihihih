"""Server-to-server client for the separately deployed remote emulator."""

import base64
import binascii
import os
import re
from urllib.parse import urlsplit

import httpx

MAX_FLASH_BYTES = 16 * 1024 * 1024
BOARD_IDS = frozenset({"esp32-devkit-v1", "esp32-devkit-c-v4", "esp32-s3", "esp32-c3"})
_SESSION_ID = re.compile(r"[0-9a-f]{32}\Z")


class RemoteSimulationError(RuntimeError):
    """A safe error suitable for reporting without remote credentials."""


def validate_flash(firmware_b64: str) -> None:
    if not isinstance(firmware_b64, str) or not firmware_b64:
        raise ValueError("firmware_b64 must be nonempty base64 merged flash")
    if len(firmware_b64) > 4 * ((MAX_FLASH_BYTES + 2) // 3):
        raise ValueError("merged flash exceeds 16 MiB")
    try:
        flash = base64.b64decode(firmware_b64, validate=True)
    except (ValueError, binascii.Error) as from_exception:
        raise ValueError("firmware_b64 must be valid base64") from from_exception
    if not flash or len(flash) > MAX_FLASH_BYTES:
        raise ValueError("merged flash must contain 1 byte to 16 MiB")


class RemoteSimulationClient:
    """No default endpoint, model-selected endpoint, or local emulator fallback."""

    def __init__(self, url: str, token: str, *, transport=None):
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except (ValueError, TypeError):
            raise RemoteSimulationError("REMOTE_SIMULATION_URL must be a valid HTTPS URL") from None
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment
                or any(c.isspace() for c in url) or "\\" in url
                or (port is not None and not 1 <= port <= 65535)):
            raise RemoteSimulationError("REMOTE_SIMULATION_URL must be a valid HTTPS URL without credentials, query, or fragment")
        if not isinstance(token, str) or len(token) < 32 or any(c.isspace() for c in token):
            raise RemoteSimulationError("REMOTE_SIMULATION_TOKEN must be a non-whitespace token of at least 32 characters")
        self._client = httpx.AsyncClient(
            base_url=url.rstrip("/") + "/",
            headers={"Authorization": "Bearer " + token},
            timeout=httpx.Timeout(connect=5, read=30, write=30, pool=5),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    @classmethod
    def from_env(cls, *, transport=None):
        url = os.environ.get("REMOTE_SIMULATION_URL", "")
        token = os.environ.get("REMOTE_SIMULATION_TOKEN", "")
        if not url or not token:
            raise RemoteSimulationError("Remote simulation is not configured; set REMOTE_SIMULATION_URL and REMOTE_SIMULATION_TOKEN on the backend")
        return cls(url, token, transport=transport)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        await self._client.aclose()

    async def _request(self, method, path, payload=None):
        try:
            response = await self._client.request(method, path, json=payload)
        except httpx.TimeoutException:
            raise RemoteSimulationError("Remote simulation request timed out") from None
        except httpx.HTTPError:
            raise RemoteSimulationError("Remote simulation server is unreachable") from None
        if not 200 <= response.status_code < 300:
            raise RemoteSimulationError(f"Remote simulation request failed (HTTP {response.status_code})")
        try:
            result = response.json()
        except ValueError:
            raise RemoteSimulationError("Remote simulation returned invalid JSON") from None
        if not isinstance(result, dict):
            raise RemoteSimulationError("Remote simulation returned an invalid response")
        return result

    @staticmethod
    def _session_path(session_id):
        if not isinstance(session_id, str) or not _SESSION_ID.fullmatch(session_id):
            raise ValueError("session_id must be a server-issued 32-character hexadecimal ID")
        return "sessions/" + session_id

    async def health(self):
        return await self._request("GET", "health")

    async def capabilities(self):
        return await self._request("GET", "capabilities")

    async def start(self, board_id: str, firmware_b64: str):
        if board_id not in BOARD_IDS:
            raise ValueError("unsupported board_id")
        validate_flash(firmware_b64)
        return await self._request("POST", "sessions", {"board_id": board_id, "firmware_b64": firmware_b64})

    async def results(self, session_id: str, *, after: int = 0):
        if type(after) is not int or after < 0:
            raise ValueError("after must be a nonnegative integer")
        return await self._request("GET", self._session_path(session_id) + f"?after={after}")

    async def stop(self, session_id: str):
        return await self._request("POST", self._session_path(session_id) + "/stop", {})

    async def serial_input(self, session_id: str, data: bytes):
        if not isinstance(data, bytes) or not 1 <= len(data) <= 4096:
            raise ValueError("serial input must contain 1 to 4096 bytes")
        return await self._request("POST", self._session_path(session_id) + "/input", {
            "type": "serial", "data_b64": base64.b64encode(data).decode("ascii"),
        })
