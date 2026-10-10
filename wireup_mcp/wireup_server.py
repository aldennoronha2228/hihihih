"""WireUp MCP server.

Exposes the running WireUp instance (circuit projects, component catalog,
firmware, compile, simulation, samples) as MCP tools.

Design constraints, deliberately:

* It imports nothing from ``backend``. It is an HTTP client for the
  already-running FastAPI app, so it cannot corrupt the JSON project store
  (``HardwareService`` guards that with a ``threading.RLock`` and atomic
  ``os.replace``; a second writer process would break it).
* Mutations are issued as ``HardwareService.command`` calls over
  ``POST /api/hardware/project/{id}/command``, which is exactly what the
  in-app LangGraph agent does. Revision checks, the feasibility approval
  machine, and revision-scoped artifacts therefore all still apply.
* It is a separate process on its own transport, so ``SecurityMiddleware``'s
  bearer/Origin/concurrency rules are untouched and ``--workers 1`` stays
  correct.

Transports:
  stdio — ``python -m mcp.wireup_server`` (what opencode launches)
  SSE   — ``python -m mcp.wireup_sse_server --port 8002``
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP

from wireup_mcp.wireup_api import (
    WireUpError,
    artifact,
    base_url,
    catalog,
    command,
    create_project,
    delete_project,
    get_project,
    health,
    list_projects,
    list_samples,
    open_sample,
)

mcp = FastMCP(
    name='wireup',
    instructions=(
        'WireUp MCP server — inspect and drive a running WireUp instance: list and read '
        'circuit projects, search the component catalog, add/remove components, wire pins, '
        'edit firmware, compile, run simulations, and open built-in sample projects.\n\n'
        'The backend must already be running (npm run dev). Every mutating tool goes through '
        'the same HardwareService command endpoint the in-app agent uses, so feasibility '
        'gates and revision checks still apply. Read the project first: its `revision` is '
        'required as `expected_revision` for most edits so concurrent browser edits are not '
        'silently clobbered.'
    ),
)


async def _guard(awaitable):
    """Turn transport/4xx/5xx failures into clean tool errors, never stack traces."""
    try:
        return await awaitable
    except WireUpError as exc:
        raise ValueError(str(exc)) from exc


def _dump(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, indent=2, default=str)[:60000]
    return str(value)[:60000]


# ---------------------------------------------------------------------------
# Site / backend status
# ---------------------------------------------------------------------------


@mcp.tool()
async def wireup_health() -> str:
    """Check that the WireUp backend is running and reachable, and show which base URL is used."""
    return _dump(await _guard(health()))


@mcp.tool()
async def wireup_info() -> str:
    """Show the backend base URL this MCP is pointed at, without making a request."""
    return f'WireUp API base URL: {base_url()}'


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_circuit_projects() -> str:
    """List every saved WireUp project with its id, name, board, revision and timestamps."""
    return _dump(await _guard(list_projects()))


@mcp.tool()
async def read_circuit_project(project_id: Annotated[str, 'Project id from list_circuit_projects.']) -> str:
    """Read one project in full: components, wires, firmware source, revision, runtime_token.

    Always call this before mutating — it returns the `revision` needed for
    `expected_revision`, and the `runtime_token` required by simulation commands.
    """
    return _dump(await _guard(get_project(project_id)))


@mcp.tool()
async def new_circuit_project(
    name: Annotated[str, 'Human-readable project name, 1-120 characters.'],
    board: Annotated[
        str,
        "Board id from the catalog, e.g. 'arduino-uno', 'arduino-nano', 'esp32-devkit-v1', "
        "'raspberry-pi-4', or 'unselected'.",
    ] = 'unselected',
) -> str:
    """Create a new empty project, optionally seeded with a board. Returns its id and runtime_token."""
    return _dump(await _guard(create_project(name, board)))


@mcp.tool()
async def delete_circuit_project(project_id: Annotated[str, 'Project id to delete.']) -> str:
    """Delete a project permanently.

    Fails if the project is currently open in a browser hardware workspace or has a
    running native ESP32 simulation; stop those first.
    """
    return _dump(await _guard(delete_project(project_id)))


# ---------------------------------------------------------------------------
# Catalog and samples
# ---------------------------------------------------------------------------


@mcp.tool()
async def search_catalog(
    query: Annotated[str, 'Search text, e.g. "neopixel", "oled", "i2c", "temperature". Empty returns all.'] = '',
    limit: Annotated[int, 'Maximum number of results (1-200).'] = 50,
) -> str:
    """Search the hardware/component catalog for available parts and boards, with their pins."""
    return _dump(await _guard(catalog(query, limit)))


@mcp.tool()
async def list_sample_projects() -> str:
    """List every bundled Velxio example/sample with its category, capability gaps and starter flag."""
    return _dump(await _guard(list_samples()))


@mcp.tool()
async def open_sample_project(sample_id: Annotated[str, 'Sample id from list_sample_projects.']) -> str:
    """Create a new project from a bundled sample, returning the project plus setup guidance.

    Samples carry real upstream source and may need libraries installed manually; the
    returned `setup_guidance` states the simulation scope and any blockers.
    """
    return _dump(await _guard(open_sample(sample_id)))


# ---------------------------------------------------------------------------
# Circuit editing (all via HardwareService.command, so gates still apply)
# ---------------------------------------------------------------------------


@mcp.tool()
async def add_component(
    project_id: Annotated[str, 'Target project id.'],
    type: Annotated[str, 'Exact component type from search_catalog, e.g. "neopixel", "bme280".'],
    id: Annotated[str, 'Optional stable component id; generated if omitted.'] = '',
    x: Annotated[float, 'Canvas X position in pixels.'] = 120.0,
    y: Annotated[float, 'Canvas Y position in pixels.'] = 100.0,
    rotation: Annotated[int, 'Rotation in degrees (0/90/180/270).'] = 0,
    properties: Annotated[dict | None, 'Component property values, e.g. {"color": "red"}.'] = None,
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project; prevents clobbering browser edits.'] = None,
) -> str:
    """Add a catalog component to a project."""
    args: dict[str, Any] = {'type': type, 'x': x, 'y': y, 'rotation': rotation}
    if id:
        args['id'] = id
    if properties:
        args['properties'] = properties
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'add_component', args)))


@mcp.tool()
async def remove_component(
    project_id: Annotated[str, 'Target project id.'],
    component_id: Annotated[str, 'Id of the component to remove.'],
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Remove a component and every wire attached to it."""
    args: dict[str, Any] = {'id': component_id}
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'remove_component', args)))


@mcp.tool()
async def modify_component(
    project_id: Annotated[str, 'Target project id.'],
    component_id: Annotated[str, 'Id of the component to change.'],
    x: Annotated[float | None, 'New canvas X, or omit to keep.'] = None,
    y: Annotated[float | None, 'New canvas Y, or omit to keep.'] = None,
    rotation: Annotated[int | None, 'New rotation in degrees, or omit to keep.'] = None,
    properties: Annotated[dict | None, 'Replacement property values, or omit to keep.'] = None,
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Change a component's position, rotation or properties."""
    args: dict[str, Any] = {'id': component_id}
    if x is not None:
        args['x'] = x
    if y is not None:
        args['y'] = y
    if rotation is not None:
        args['rotation'] = rotation
    if properties is not None:
        args['properties'] = properties
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'modify_component', args)))


@mcp.tool()
async def connect_pin(
    project_id: Annotated[str, 'Target project id.'],
    from_component: Annotated[str, 'Source component id.'],
    from_pin: Annotated[str, 'Source pin name, e.g. "D4", "VCC", "SDA".'],
    to_component: Annotated[str, 'Target component id.'],
    to_pin: Annotated[str, 'Target pin name.'],
    color: Annotated[str, 'Wire colour, e.g. "red", "black".'] = '',
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Connect two known component pins with a single wire."""
    args: dict[str, Any] = {
        'from': {'component': from_component, 'pin': from_pin},
        'to': {'component': to_component, 'pin': to_pin},
    }
    if color:
        args['color'] = color
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'connect_wire', args)))


@mcp.tool()
async def wire_circuit(
    project_id: Annotated[str, 'Target project id.'],
    wires: Annotated[
        list[dict],
        'Atomic batch of connections: [{"from_component": "board", "from_pin": "D4", '
        '"to_component": "led1", "to_pin": "D1"}]. One invalid connection rejects the whole batch.',
    ],
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Wire a whole circuit in one atomic, validated batch.

    Preferred over many connect_pin calls: validation runs up front and known
    rail shorts are rejected before anything is written.
    """
    batch = [{
        'from': {'component': wire['from_component'], 'pin': wire['from_pin']},
        'to': {'component': wire['to_component'], 'pin': wire['to_pin']},
        **({'color': wire['color']} if wire.get('color') else {}),
    } for wire in wires]
    args: dict[str, Any] = {'batch': batch}
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'wire_circuit', args)))


@mcp.tool()
async def remove_wire(
    project_id: Annotated[str, 'Target project id.'],
    wire_id: Annotated[str, 'Id of the wire to remove.'],
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Remove a single wire."""
    args: dict[str, Any] = {'id': wire_id}
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'remove_wire', args)))


@mcp.tool()
async def validate_circuit(project_id: Annotated[str, 'Target project id.']) -> str:
    """Inspect the project's actual wires and rail/LED topology, with warnings.

    This reports evidence and limited validation; it does not certify general electrical safety.
    """
    return _dump(await _guard(command(project_id, 'validate_circuit', {})))


# ---------------------------------------------------------------------------
# Firmware, compile, simulation
# ---------------------------------------------------------------------------


@mcp.tool()
async def read_firmware(project_id: Annotated[str, 'Target project id.']) -> str:
    """Read the current firmware source and its revision."""
    return _dump(await _guard(command(project_id, 'read_firmware', {})))


@mcp.tool()
async def write_firmware(
    project_id: Annotated[str, 'Target project id.'],
    source: Annotated[str, 'Complete replacement firmware source.'] = '',
    old: Annotated[str, 'Exact substring to replace (use with `new`).'] = '',
    new: Annotated[str, 'Replacement substring (use with `old`).'] = '',
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Replace the firmware wholesale (pass `source`), or make one exact `old` -> `new` edit.

    Prefer `old`/`new` for small changes so concurrent edits survive.
    """
    args: dict[str, Any] = {}
    if source:
        args['source'] = source
    if old:
        args['old'] = old
    if new:
        args['new'] = new
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'edit_firmware', args)))


@mcp.tool()
async def compile_project(
    project_id: Annotated[str, 'Target project id.'],
    expected_revision: Annotated[int | None, 'Revision from read_circuit_project.'] = None,
) -> str:
    """Compile the current firmware and return real diagnostics plus an artifact id.

    Does not start a simulation. Requires arduino-cli with the board core installed.
    """
    args: dict[str, Any] = {}
    if expected_revision is not None:
        args['expected_revision'] = expected_revision
    return _dump(await _guard(command(project_id, 'compile_firmware', args)))


@mcp.tool()
async def read_compiler_errors(project_id: Annotated[str, 'Target project id.']) -> str:
    """Read the latest compiler diagnostics. Never compiles implicitly."""
    return _dump(await _guard(command(project_id, 'read_compiler_errors', {})))


@mcp.tool()
async def read_artifact(
    project_id: Annotated[str, 'Target project id.'],
    artifact_id: Annotated[str, 'Artifact id returned by compile_project.'],
) -> str:
    """Fetch the compiled hex/binary for an artifact (Intel HEX text for AVR, base64 otherwise)."""
    return _dump(await _guard(artifact(project_id, artifact_id)))


@mcp.tool()
async def run_simulation(
    project_id: Annotated[str, 'Target project id.'],
    runtime_token: Annotated[str, 'runtime_token from read_circuit_project.'],
    artifact_id: Annotated[str, 'Artifact to run; omit to use the latest compiled artifact.'] = '',
) -> str:
    """Start simulation of the compiled artifact in the connected browser.

    Requires a browser hardware workspace open on that project (it drives the runtime
    WebSocket). `runtime_token` comes from read_circuit_project.
    """
    args: dict[str, Any] = {}
    if artifact_id:
        args['artifact_id'] = artifact_id
    return _dump(await _guard(command(project_id, 'run_simulation', args, runtime_token)))


@mcp.tool()
async def stop_simulation(
    project_id: Annotated[str, 'Target project id.'],
    runtime_token: Annotated[str, 'runtime_token from read_circuit_project.'],
) -> str:
    """Stop the running simulation in the connected browser."""
    return _dump(await _guard(command(project_id, 'stop_simulation', {}, runtime_token)))


@mcp.tool()
async def read_simulation_results(
    project_id: Annotated[str, 'Target project id.'],
    runtime_token: Annotated[str, 'runtime_token from read_circuit_project.'],
) -> str:
    """Read actual runtime results (pins, serial) from the connected browser simulation."""
    return _dump(await _guard(command(project_id, 'read_simulation_results', {}, runtime_token)))


@mcp.tool()
async def undo_last_change(project_id: Annotated[str, 'Target project id.']) -> str:
    """Undo the most recent edit in a project's history stack."""
    return _dump(await _guard(command(project_id, 'undo', {})))


@mcp.tool()
async def calculate(
    project_id: Annotated[str, 'Any existing project id (the backend requires one).'],
    expression: Annotated[str, 'Bounded numeric expression, e.g. "(3.3/1024)*512".'],
) -> str:
    """Evaluate a bounded arithmetic expression. No code or shell execution.

    The backend evaluates this through a project command, so any existing
    project id is needed even though the result does not touch the circuit.
    """
    return _dump(await _guard(command(project_id, 'calculator', {'expression': expression})))