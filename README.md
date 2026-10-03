# WireUp hardware prototyping platform

WireUp combines a dark Vite/React/TypeScript interface, circuit and schematic workspaces, real Arduino compilation, Velxio CPU emulation, ngspice analog analysis, and a Python LangGraph/Groq hardware agent.

## Start

```powershell
npm install
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -r backend/requirements.txt
npm run dev
```

Existing dependencies are installed here. Open http://127.0.0.1:5173. The root prompt creates a prototype and opens its project-scoped agent and canvas. Existing prototypes appear on the home page; `/projects` redirects there. `/assistant` and `/chat/:id` preserve earlier chat access; `/orb` preserves the background demo.

Without uv: `python -m venv .venv`, then `.venv\Scripts\python.exe -m pip install -r backend/requirements.txt`. The npm Python launcher supports Windows and Unix virtual environments.

Windows backend code edits require restarting `npm run dev:api`; reload is disabled there to keep the Proactor event loop required by compiler subprocesses. Frontend changes reload normally. `npm run dev:web` and `npm run dev:api` can run separately.

## Groq environment

Root `.env` contains server-only settings:

```dotenv
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-120b
NVIDIA_API_KEY=your_nvidia_key_here
NVIDIA_MODEL=z-ai/glm-5.3
BACKEND_PORT=8000
```

Key/model edits apply on the next request. Port edits require restarting. Never use a `VITE_` API-key variable. `.env` is ignored; `.env.example` contains no key. Groq rate limits can block real builds even with a valid key. The agent retries the same model call at most twice with bounded waiting and never repeats already-completed tool mutations automatically. Check https://console.groq.com/settings/limits. A completed local test is not evidence that a provider quota problem is resolved.

The **Chat model** selector in every chat composer switches between configured Groq and NVIDIA models and remembers the choice in this browser. NVIDIA uses the fixed OpenAI-compatible endpoint `https://integrate.api.nvidia.com/v1` through LangChain `ChatOpenAI`, retaining the same LangGraph hardware tools. The selector is disabled during generation. The configured model must support tools and be available to your NVIDIA account; a 403 response requires resolving provider/model access. Keys stay server-side and are never included in model-list responses.

## Workspace

- Large circuit canvas, categorized visual catalog, right-side agent, floating fit/zoom controls, and compact collapsible console.
- Circuit/Schematic representations of the same project; no Builder/Studio switch.
- Sketch drawer for firmware editing; save/undo, real Compile, Run/Stop, serial and diagnostics.
- Canonical project data persists under ignored `backend/data/hardware/`; revision checks prevent stale edits from overwriting changes.
- Supported local MCU targets: Arduino Uno, Nano, Mega, Raspberry Pi Pico. Click a supported board in the catalog to replace the current MCU while preserving stable `board` ID. Remove attached wires first; replacement invalidates compilation. Multiple simultaneously emulated MCUs are not supported by this project adapter.
- ESP32 QEMU is not configured, so ESP32 simulation is unavailable even though upstream Velxio advertises it in its container/hosted builds.

## Agent and project questions

The request-local LangGraph binds 16 real domain tools: project read, catalog search, component add/remove/modify, wire connect/remove, firmware generate/read/edit, compile, simulation run/stop/results, compiler diagnostics, calculator. `ask_project_questions` adds the project-understanding stage.

Initial project build prompts pause with a compact multiple-choice card. Confirming choices sends actual selected requirements to the same project's agent, which can mutate the circuit and firmware through the same services as manual controls. Read-before-mutation and revisions are enforced. Limits: 60 tool calls, 48 model calls, 300 seconds. Tool failures and provider failures are reported; the UI must not imply that advice alone built a project.

The activity feed streams actual tool starts/ends, provider reasoning where returned, answer text, and terminal status over NDJSON. Thinking is temporary and omitted from saved chat storage. Steps stay visible as a live checklist: a status header with elapsed time, one check-marked row per tool with narration kept inline, and each row expands to its actual command and output; final answers render below the checklist. It does not display a complete internal chain of thought, simulate shell commands, or invent tool executions. Chats are browser-local and project-scoped.

## SPICE and instruments

Catalog includes DC voltage/current, sine/pulse/PWL/AC voltage sources, ground, resistors, capacitors, and inductors. DC Bias and Transient use actual ngspice WASM arrays and show real solver errors. AC sources carry small-signal parameters, but AC sweeps are not implemented.

Oscilloscope/logic analyzer uses bounded actual digital pin-edge capture. Channels, time/division, view pause/resume, and clear are available. Analog mode displays actual SPICE voltage samples or DC readings. Unknown/unobserved signals are not drawn as invented waveforms.

**Current boundaries:** The adapted peripheral runtime supports LED continuity and rail-connected buttons; other catalog peripherals may be placement-only. Analog DC/transient analysis is separate from MCU GPIO/ADC simulation, not a fully coupled mixed-signal engine. Pico uses UART0 (Serial1 compatibility), not emulated USB CDC or radio. The physical circuit view is 2D, not genuine 3D. Full upstream Velxio feature parity is not claimed.

## Source and license

Velxio source is preserved under `vendor/velxio`, pinned to revision `3e45cada3f362ce61fe2c8515f7fee0f7acf4113`. See `vendor/VELXIO_PROVENANCE.md`, upstream `LICENSE`, and `COMMERCIAL_LICENSE.md`. Velxio is AGPLv3/commercial dual-licensed; integrated distribution/network deployments must comply with the applicable license. Closed-source deployment requires appropriate licensing.

Reusable UI is in `src/components/ui`; `@/` maps to `src/`. Global styles are `src/index.css`; workspace and instrument styling is scoped in component CSS. Tailwind v4 and shadcn are configured.

## Checks

```powershell
npm run build
npm run lint
npm run test:api
npm test -- --workers=1
```

Tests distinguish injected model responses from actual compiler/emulator/ngspice execution. Browser tests use installed Chrome and software WebGL; real provider tests require available Groq quota. `npm run preview` serves frontend assets only, not the backend API.

The local API uses loopback guards and runtime ownership tokens. It is not an authenticated multi-user service. Add authentication, authorization, request limits, isolated compilation, and proper persistence before public deployment. Firmware compilation has no arbitrary shell tool, but native compilers still need deployment sandboxing.
