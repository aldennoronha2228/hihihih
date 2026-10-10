# WireUp live 20-project release audit

Attempts completed: 5/20. Each project starts from a new board-only project; no example/template source is inserted by the test.
Models are real configured providers. The test selects AI-choice answers while retaining the exact requested board. Simulator execution is independently exercised in the actual mounted browser.
This matrix samples component families; it is not exhaustive testing of every catalog component.

## Provider chat probes
| Provider | HTTP | Final status | Response |
|---|---:|---|---|
| azure | 200 | success | Hello from WireUp release testing. |

## Fresh project attempts
| Project | Board | AI final | Parts / wires | Compile | Simulation |
|---|---|---|---|---|---|
| mega-rgb | arduino-mega | success | 5 / 7 | simulation_ready | verified_run |
| pico-w-led | pi-pico-w | success | 3 / 3 | simulation_ready | not run |
| uno-oled | arduino-uno | success | 2 / 4 | simulation_ready | verified_run |
| uno-bmp | arduino-uno | success | 4 / 8 | simulation_ready | verified_run |
| uno-switches | arduino-uno | success | 3 / 9 | simulation_ready | verified_run |

## Findings
- **pico-w-led**: TimeoutError: locator.waitFor: Timeout 45000ms exceeded. Call log:   - waiting for getByRole('button', { name: 'Stop', exact: true }) to be visible

## Evidence boundaries
A successful process start or firmware compile is not proof the design is electrically safe or functionally correct. No physical board was flashed. Serial output is recorded, not invented. Provider key/credentials and compiled binary payloads are excluded from this report. Detailed per-project activity, actual source and topology are recorded in the JSON artifact.
