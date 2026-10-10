"""Optional SSE sidecar, for clients that cannot speak stdio.

    python -m wireup_mcp.wireup_sse_server --port 8002

This runs as its own process on its own port on purpose. Mounting `/mcp`
inside the main FastAPI app would put it behind ``SecurityMiddleware``
(Origin allowlist, bearer token, per-process concurrency cap) and behind
Caddy's routing, both of which break MCP clients — neither sends an Origin
header. A sidecar mirrors what vendored Velxio already does, and leaves the
existing deployment completely unmodified.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

from wireup_mcp.wireup_server import mcp  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description='WireUp MCP SSE server')
    parser.add_argument('--host', default='127.0.0.1', help='Bind address (default: 127.0.0.1, loopback only)')
    parser.add_argument('--port', type=int, default=8002, help='Port (default: 8002)')
    args = parser.parse_args()
    uvicorn.run(mcp.sse_app(), host=args.host, port=args.port, log_level='warning')


if __name__ == '__main__':
    main()