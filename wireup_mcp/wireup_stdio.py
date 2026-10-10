"""stdio entrypoint. This is what opencode launches.

    python -m wireup_mcp.wireup_stdio

stdout is reserved for the MCP protocol, so all diagnostics go to stderr.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wireup_mcp.wireup_server import mcp  # noqa: E402

if __name__ == '__main__':
    mcp.run(transport='stdio')