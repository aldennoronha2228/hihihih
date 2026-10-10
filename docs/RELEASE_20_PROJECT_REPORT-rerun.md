# WireUp live 20-project release audit

Attempts completed: 20/20. Each project starts from a new board-only project; no example/template source is inserted by the test.
Models are real configured providers. The test selects AI-choice answers while retaining the exact requested board. Simulator execution is independently exercised in the actual mounted browser.
This matrix samples component families; it is not exhaustive testing of every catalog component.

## Provider chat probes
| Provider | HTTP | Final status | Response |
|---|---:|---|---|
| groq | 200 | success | Hello from WireUp release testing. |
| nvidia | 200 | error | Connecting to NVIDIA model z-ai/glm-5.3… The model provider did not respond within 20 seconds. Retry or select another model. |
| bedrock | 200 | error | Connecting to BEDROCK model zai.glm-5… Amazon Bedrock authorization failed. Check the selected authentication mode, credentials, IAM permissions, and regional model access. |
| azure | 200 | success | Hello from WireUp release testing. |

## Fresh project attempts
| Project | Board | AI final | Parts / wires | Compile | Simulation |
|---|---|---|---|---|---|
| uno-led | arduino-uno | success | 3 / 3 | simulation_ready | verified_run |
| nano-button | arduino-nano | success | 4 / 5 | simulation_ready | verified_run |
| mega-rgb | arduino-mega | error | 5 / 7 | not compiled | not_run_no_current_artifact |
| uno-servo | arduino-uno | success | 2 / 3 | simulation_ready | verified_run |
| nano-ultrasonic | arduino-nano | success | 2 / 4 | simulation_ready | verified_run |
| mega-pot | arduino-mega | success | 4 / 6 | simulation_ready | verified_run |
| pico-pot | pi-pico | success | 2 / 3 | simulation_ready | verified_run |
| pico-w-led | pi-pico-w | failed before build | 0 / 0 | not completed | not run |
| c3-led | esp32-c3 | success | 3 / 3 | simulation_ready | verified_run |
| s3-button | esp32-s3 | success | 4 / 5 | simulation_ready | verified_run |
| classic-v1 | esp32-devkit-v1 | success | 3 / 3 | compilation_complete | unavailable |
| classic-cv4 | esp32-devkit-c-v4 | success | 2 / 3 | compilation_complete | unavailable |
| uno-dht | arduino-uno | success | 4 / 7 | simulation_ready | verified_run |
| uno-oled | arduino-uno | error | 1 / 0 | not compiled | not_run_no_current_artifact |
| uno-lcd | arduino-uno | success | 2 / 4 | simulation_ready | verified_run |
| uno-rtc | arduino-uno | success | 5 / 10 | simulation_ready | verified_run |
| uno-mpu | arduino-uno | success | 2 / 5 | simulation_ready | verified_run |
| uno-bmp | arduino-uno | failed before build | 0 / 0 | not completed | not run |
| uno-switches | arduino-uno | failed before build | 0 / 0 | not completed | not run |
| uno-mixed | arduino-uno | success | 4 / 11 | simulation_ready | verified_run |

## Findings
- **mega-rgb**: build_not_executed
- **pico-w-led**: Error: page.evaluate: Execution context was destroyed, most likely because of a navigation.
- **classic-v1**: Simulation is currently unavailable for ESP32 DevKit V1. You can still build the circuit and write source code. Classic ESP32 requires the compatible patched native Velxio QEMU runtime; the official WASM emulator does not support this chip.
- **classic-cv4**: Simulation is currently unavailable for ESP32 DevKit C V4. You can still build the circuit and write source code. Classic ESP32 requires the compatible patched native Velxio QEMU runtime; the official WASM emulator does not support this chip.
- **uno-oled**: AI did not generate requested source/parts.
- **uno-bmp**: Error: page.evaluate: Execution context was destroyed, most likely because of a navigation.
- **uno-switches**: Error: page.evaluate: Execution context was destroyed, most likely because of a navigation.

## Evidence boundaries
A successful process start or firmware compile is not proof the design is electrically safe or functionally correct. No physical board was flashed. Serial output is recorded, not invented. Provider key/credentials and compiled binary payloads are excluded from this report. Detailed per-project activity, actual source and topology are recorded in the JSON artifact.
