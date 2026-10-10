# Release regression audit

## Verdict and provenance

**The audited regression gate is not green: five backend tests fail reproducibly.** TypeScript checking and the production build pass. Oxlint completes with zero errors and 27 warnings. This is not a hardware, browser-runtime, or live-provider release sign-off.

- Audit date: 2026-10-10; verification finished around 10:50 +05:30.
- Repository: `C:\Users\admin\Downloads\simply`.
- HEAD: `0aa65c8a9729cefdb6b3b146abf730a2125f0fd5`.
- Results describe the existing dirty working tree, including its tracked modifications and untracked additions, not pristine HEAD.
- Runtimes: existing `.venv\Scripts\python.exe`, Python 3.14.0 (uv-managed installation); `C:\Program Files\nodejs\node.exe`, Node v22.23.1. No dependency installation or environment-file editing was performed.
- Only this audit document was authored. No source or test files were changed. Requested build execution regenerated ignored `dist` output and TypeScript build metadata under `node_modules/.tmp`; pytest used `-p no:cacheprovider` and temporary test directories. The tracked/untracked status listing after verification matched the initial listing before this document was created.

## Current results

| Check | Current result | Exit | Reported test/tool duration |
| --- | --- | --- | --- |
| Deterministic `backend/tests` suite | **898 passed, 5 failed, 10 deselected, 2 warnings**; 913 collected, 903 executed; no skips or collection errors reported | 1 | 250.46 s |
| Independent security and mocked remote-simulation contracts | **118 passed**, no failures, skips, or warnings reported | 0 | 11.42 s |
| Focused reproduction of failing test families | **5 failed, 4 passed, 93 deselected, 2 warnings**; reproduces every full-suite failure | 1 | 11.40 s |
| TypeScript `tsc -b` | Passed; no diagnostics printed | 0 | Combined tsc/build process: 58.52 s wall time |
| Vite production build | Passed; **2,632 modules transformed**; nonfatal warnings below | 0 | 20.11 s |
| Oxlint configured targets | **27 warnings, 0 errors**, 123 files, 116 rules, 8 threads | 0 | 659 ms |
| Initial oxlint `require` invocation | Tool-loading failure, not a lint finding: `ERR_REQUIRE_ASYNC_MODULE`; corrected invocation succeeds | 1 | 1.40 s wall time |

The two primary Python executions total **1,021 executed cases: 1,016 passed and 5 failed**, with 10 additional backend cases deliberately deselected. Focused reruns and collection-only commands are not added to these totals.

## Backend execution and exact expensive exclusions

Executed from the repository root:

`& .\.venv\Scripts\python.exe -m pytest backend/tests -q -p no:cacheprovider -k 'not real_arduino_cli_blink and not actual_asgi_route_compiles_with_launcher_loop'`

There are exactly **two excluded name predicates**, selecting **10 parametrized cases**. These start the real Arduino CLI, including heavyweight Pico and ESP32/C3/S3 toolchains. Excluded IDs were retrieved by collection only, not inferred from names:

1. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[arduino-uno]`
2. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[arduino-nano]`
3. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[arduino-mega]`
4. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[pi-pico]`
5. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[pi-pico-w]`
6. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[esp32-devkit-v1]`
7. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[esp32-devkit-c-v4]`
8. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[esp32-s3]`
9. `backend/tests/test_hardware.py::test_real_arduino_cli_blink[esp32-c3]`
10. `backend/tests/test_run.py::test_actual_asgi_route_compiles_with_launcher_loop`

Collection evidence command:

`& .\.venv\Scripts\python.exe -m pytest backend/tests --collect-only -q -p no:cacheprovider -k 'real_arduino_cli_blink or actual_asgi_route_compiles_with_launcher_loop'`

It returned `10/913 tests collected (903 deselected) in 6.45s`.

No broad `not compile`, `not real`, `not pico`, or `not c3` filter was used. Mocked compiler artifacts, failure handling, timeouts, cancellation, Pico loading, and ESP32 merged-flash contracts remained in the suite. Native ESP32 lifecycle tests use mocked process creation, not a real QEMU process. The lightweight Python subprocess-loop unit test remained selected; it currently fails before spawning because its expected loop factory is absent.

Independent safe contracts were executed with:

`& .\.venv\Scripts\python.exe -m pytest tests/test_security.py deployment/remote-simulation/test_remote_simulation.py -q -p no:cacheprovider`

These use direct ASGI calls, FastAPI TestClient, fake managers, and mocked HTTP transports. They do not require the running application backend, physical hardware, real QEMU, or an actual AI provider.

## All current backend failures

| Failing test ID | Retrieved failure evidence | Interpretation and boundary |
| --- | --- | --- |
| `backend/tests/test_board_selection.py::test_unavailable_boards_never_dispatch_browser_runtime[esp32-devkit-v1]` | `backend/hardware.py:1061`: `AttributeError: 'RejectRuntime' object has no attribute 'sessions'`; call originates at test line 128 | Classic ESP32 runtime-adapter detection accesses `.sessions` on the injected runtime before returning the expected controlled HTTP exception. This demonstrates a runtime-contract incompatibility; it does not demonstrate a live-browser failure. |
| `backend/tests/test_board_selection.py::test_unavailable_boards_never_dispatch_browser_runtime[esp32-devkit-c-v4]` | Same exception and source location | Same incompatibility for the second classic ESP32 board. |
| `backend/tests/test_run.py::test_launcher_loop_configuration[win32-False-backend.run:compiler_loop]` | Test line 30: actual loop `'none'`, expected `'backend.run:compiler_loop'` | Current Windows launcher uses the event-loop policy and `loop='none'`; test expects a named factory. The assertion fails. Actual launched-server compilation was deliberately not verified. |
| `backend/tests/test_run.py::test_compiler_loop_launches_subprocess` | Test line 45: `AttributeError: module 'backend.run' has no attribute 'compiler_loop'` | The referenced loop factory does not exist in current `backend/run.py`; the unit test fails before its child Python process can start. |
| `backend/tests/test_sample_projects.py::test_gallery_blocked_examples_do_not_create_projects` | Test line 154: opening `/api/hardware/samples/ky-040-rotary-encoder/open` returns **200**, expected **409** | Current gallery behavior disagrees with the blocked-example assertion. The failure alone does not establish whether the newer rotary capability or the older blocked expectation is the intended release contract. |

All five failures reproduced without edits using:

`& .\.venv\Scripts\python.exe -m pytest backend/tests/test_board_selection.py backend/tests/test_run.py backend/tests/test_sample_projects.py -q -p no:cacheprovider --tb=short -k 'unavailable_boards_never_dispatch_browser_runtime or launcher_loop_configuration or compiler_loop_launches_subprocess or gallery_blocked_examples_do_not_create_projects'`

Both runs also reported the same two Python 3.14 deprecations at `backend/run.py:26`: `asyncio.WindowsProactorEventLoopPolicy` and `asyncio.set_event_loop_policy`, slated for removal in Python 3.16. No fixes, suppressions, or test-expectation changes were made.

## Frontend build and lint evidence

The configured build is `tsc -b && vite build`. Both stages were executed with absolute Node, an explicit `process.chdir('C:/Users/admin/Downloads/simply')`, and root-absolute CLI paths. TypeScript's CommonJS CLI was loaded with `require('C:/Users/admin/Downloads/simply/node_modules/typescript/bin/tsc')`, with `process.argv` set to `['node','tsc','-b']`. The ESM Vite CLI was loaded with `import('file:///C:/Users/admin/Downloads/simply/node_modules/vite/bin/vite.js')`, with `process.argv` set to `['node','vite','build']`. Evidence includes `TSC_EXIT_CODE=0` and `VITE_BUILD_EXIT_CODE=0`; Vite reported version **8.3.2**.

Nonfatal build diagnostics:

- Direct `eval` in `vendor/velxio/frontend/node_modules/rp2040js/dist/esm/utils/time.js:6:27`.
- Minified chunks exceed the 500 kB warning threshold: `hardware-workspace-C7LhlG77.js` is **1,495.41 kB** (415.19 kB gzip); `index-CFDInxC6.js` is **1,596.50 kB** (457.22 kB gzip).
- Plugin-timing diagnostic: JavaScript callbacks ran for 18.8 s of the approximately 20.1 s build (94%); it did not fail the build.

Oxlint targets matched the package script: `src tests scripts vite.config.ts playwright.config.ts`. The same absolute Node/chdir approach initially attempted `require` of the CLI, which failed because oxlint has top-level await. It was rerun successfully using `import('file:///C:/Users/admin/Downloads/simply/node_modules/oxlint/bin/oxlint')` and `process.argv=['node','oxlint','src','tests','scripts','vite.config.ts','playwright.config.ts']`. Evidence includes `OXLINT_EXIT_CODE=0`.

All 27 current warnings are accounted for below; none were suppressed:

| Warning | Count | Locations |
| --- | --- | --- |
| `react(only-export-components)` | 9 | `src/components/ui/button.tsx:57`; `src/components/ui/agent-activity-feed.tsx:16,27`; `src/components/ui/ai-prompt-input.tsx:193,346,1360`; `src/components/schematic-canvas.tsx:22,34,45` |
| `react(set-state-in-effect)` | 11 | `src/components/ui/board-flash-dialog.tsx:33`; `src/components/chat-app.tsx:61,76,79`; `src/components/ui/ai-prompt-input.tsx:625,700,880,1519,1573`; `src/components/hardware-workspace.tsx:188,307` |
| `react(refs)` | 3 | `src/components/ui/ai-prompt-input.tsx:2253,2256`; `src/components/hardware-workspace.tsx:115` |
| `react-hooks(exhaustive-deps)` | 1 | `src/components/ui/board-flash-dialog.tsx:34` |
| `eslint(no-self-assign)` | 1 | `src/components/ui/siri-wave.tsx:328` |
| `react(preserve-manual-memoization)` | 1 | `src/components/schematic-canvas.tsx:152` |
| File-too-long/minified-file diagnostic | 1 | `src/components/ui/esp-network-dialog.tsx`; oxlint did not print a line number or rule identifier |

Oxlint's configured scope does not lint the entire vendor tree. TypeScript build scope comes from the existing project configs (`src` and `vite.config.ts`, including their imported dependencies); passing the build does not independently prove all Playwright test files typecheck.

## Explicitly unverified

- All 10 excluded real-toolchain integration cases, including Uno/Nano/Mega, Pico/Pico W, classic ESP32, S3, C3, and the real ASGI compile route.
- The parent's 20 sequential compilation cases: not run here, and no parent completion evidence was retrieved for this report.
- All browser/Playwright execution, including hardware simulation, peripheral electrical/runtime behavior, browser persistence and recovery, catalog rendering, and end-to-end interaction. No browser tests were run against a live backend.
- Actual physical-board flashing, serial hardware, radio/Wi-Fi/Bluetooth behavior, real QEMU native or deployed remote simulation, and deployment smoke execution. Passing mocked contracts is not hardware verification.
- Actual AI-provider authentication, model availability, network responses, and live-agent behavior. Provider-oriented unit tests use fake models, monkeypatched construction, or client configuration inspection, not live requests.
- Runtime correctness of the generated production bundle; the bundle was built, not served or exercised in a browser.
- Other Python versions and operating systems. Linux configuration assertions were simulated by monkeypatching platform values, not run on Linux.
- Stability under repetition or long-running load beyond the focused failure reproduction.

No real provider keys or environment secret values were intentionally printed or added to this document. Failure logs can contain ephemeral runtime tokens generated by temporary unit-test projects; they are not copied here.

## Retrieved raw evidence

These tool-generated logs are outside the repository and are session-local evidence, not additional authored deliverables:

- Full backend execution: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_8JeWLtWS8HtgzzWp43DtGBkF.log).
- Exact expensive-case collection: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_jM1X5xEMEbvYCUxrl69pQlA8.log).
- Independent contract execution: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_cB1rmLao5dsZ610Z7X59z0G8.log).
- Focused failure reproduction: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_y9NQdRFQvm4vqNYfwKwANQsq.log).
- TypeScript and Vite execution: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_U8CYZ0wWlAoBldzUiKDhUIUl.log).
- Successful oxlint execution and all diagnostics: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_S8L1WRJcqpdbIXhGQ8wP03YG.log).
- Initial oxlint loader failure: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_RosVEHjzJoE2dqW8KfR7snJz.log).
- Initial status/instruction/runtime inspection: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_oWw1fkp9KZR694GhwJQlilaT.log).
- Post-verification status and independent-case collection: [log](C:/Users/admin/.supercharge/sessions/C%3A%5CUsers%5Cadmin%5CDownloads%5Csimply/01a1243c-26b3-7210-a294-8e52b01f5b19/terminal/call_DneBmgygBGXCulWYNJ0c1xca.log).
