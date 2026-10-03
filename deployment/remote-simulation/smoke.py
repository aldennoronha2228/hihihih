"""Authenticated remote smoke check; optional merged flash exercises a real boot."""

import argparse
import asyncio
import base64
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.remote_simulation import BOARD_IDS, MAX_FLASH_BYTES, RemoteSimulationClient, RemoteSimulationError


async def check(args, *, client_factory=RemoteSimulationClient.from_env):
    async with client_factory() as client:
        health = await client.health()
        capabilities = await client.capabilities()
        if health.get("status") != "ok" or not isinstance(capabilities.get("boards"), dict):
            raise RemoteSimulationError("Remote health/capabilities contract failed")
        if args.firmware is None:
            if not health.get("emulator_available") or not capabilities["boards"]:
                raise RemoteSimulationError("No emulator machines are available")
            print("PASS: authenticated health and capabilities; boot was not requested")
            return
        if args.board not in capabilities["boards"]:
            raise RemoteSimulationError("Requested board is unavailable")
        with args.firmware.open("rb") as firmware:
            flash = firmware.read(MAX_FLASH_BYTES + 1)
        if not 1 <= len(flash) <= MAX_FLASH_BYTES:
            raise ValueError("Merged flash must contain 1 byte to 16 MiB")
        session_id = None
        try:
            result = await client.start(args.board, base64.b64encode(flash).decode("ascii"))
            session_id = result["session_id"]
            deadline = time.monotonic() + args.seconds
            cursor = 0
            serial = ""
            while True:
                result = await client.read(session_id, after=cursor)
                cursor = result["cursor"]
                serial = (serial + result["serial"])[-65536:]
                if result["status"] != "running":
                    raise RemoteSimulationError("Emulator exited during smoke check")
                if args.expect_serial and args.expect_serial in serial:
                    break
                if time.monotonic() >= deadline:
                    if args.expect_serial:
                        raise RemoteSimulationError("Expected serial marker was not observed")
                    break
                await asyncio.sleep(0.25)
        finally:
            if session_id is not None:
                stopped = await client.stop(session_id)
                if stopped.get("status") != "stopped":
                    raise RemoteSimulationError("Remote session did not stop")
        print("PASS: authenticated start/read/stop" + (" and serial marker" if args.expect_serial else ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", choices=sorted(BOARD_IDS), default="esp32-devkit-v1")
    parser.add_argument("--firmware", type=Path, help="Merged raw flash image, not ELF or application-only binary")
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--expect-serial", help="Required serial marker; serial output is never printed")
    args = parser.parse_args()
    if not 0 < args.seconds <= 60 or (args.expect_serial and args.firmware is None):
        parser.error("Use 0 < seconds <= 60; --expect-serial requires --firmware")
    try:
        asyncio.run(check(args))
    except (RemoteSimulationError, ValueError, OSError, KeyError, TypeError):
        print("FAIL: remote smoke check failed; verify configuration, server availability, and merged flash", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
