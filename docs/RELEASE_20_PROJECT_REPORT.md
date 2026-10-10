# WireUp live 20-project release audit

Attempts completed: 20/20. Each project starts from a new board-only project; no example/template source is inserted by the test.
Models are real configured providers. The test selects AI-choice answers while retaining the exact requested board. Simulator execution is independently exercised in the actual mounted browser.
This matrix samples component families; it is not exhaustive testing of every catalog component.

## Provider chat probes
| Provider | HTTP | Final status | Response |
|---|---:|---|---|
| groq | 200 | success | Hello from WireUp release testing. |
| nvidia | 200 | success | Hello and welcome from Claude — glad to receive your WireUp release testing message and I'm happy to help with any testing you need! |
| bedrock | 200 | error | Connecting to BEDROCK model zai.glm-5… Amazon Bedrock authorization failed. Check the selected authentication mode, credentials, IAM permissions, and regional model access. |
| azure | 200 | success | Hello from WireUp release testing. |

## Fresh project attempts
| Project | Board | AI final | Parts / wires | Compile | Simulation |
|---|---|---|---|---|---|
| uno-led | arduino-uno | failed before build | 0 / 0 | not completed | not run |
| nano-button | arduino-nano | failed before build | 0 / 0 | not completed | not run |
| mega-rgb | arduino-mega | success | 5 / 7 | simulation_ready | verified_run |
| uno-servo | arduino-uno | success | 2 / 3 | simulation_ready | verified_run |
| nano-ultrasonic | arduino-nano | success | 2 / 4 | simulation_ready | verified_run |
| mega-pot | arduino-mega | failed before build | 0 / 0 | not completed | not run |
| pico-pot | pi-pico | failed before build | 0 / 0 | not completed | not run |
| pico-w-led | pi-pico-w | success | 3 / 3 | simulation_ready | verified_run |
| c3-led | esp32-c3 | failed before build | 0 / 0 | not completed | not run |
| s3-button | esp32-s3 | success | 4 / 5 | simulation_ready | verified_run |
| classic-v1 | esp32-devkit-v1 | failed before build | 0 / 0 | not completed | not run |
| classic-cv4 | esp32-devkit-c-v4 | success | 2 / 3 | compilation_complete | unavailable |
| uno-dht | arduino-uno | error | 1 / 0 | not compiled | not_run_no_current_artifact |
| uno-oled | arduino-uno | failed before build | 0 / 0 | not completed | not run |
| uno-lcd | arduino-uno | success | 2 / 4 | simulation_ready | verified_run |
| uno-rtc | arduino-uno | error | 1 / 0 | not compiled | not_run_no_current_artifact |
| uno-mpu | arduino-uno | success | 4 / 9 | simulation_ready | verified_run |
| uno-bmp | arduino-uno | success | 2 / 4 | simulation_ready | verified_run |
| uno-switches | arduino-uno | success | 3 / 9 | simulation_ready | verified_run |
| uno-mixed | arduino-uno | success | 4 / 11 | simulation_ready | verified_run |

## Findings
- **uno-led**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":2},"model":"gpt-6.1-sol","elapsedMs":24580,"usage":{"input_tokens":19353,"output_tokens":718,"total_tokens":20071},"modelCalls":5,"toolCalls":5}
- **nano-button**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":4},"model":"gpt-6.1-sol","elapsedMs":26059,"usage":{"input_tokens":20542,"output_tokens":782,"total_tokens":21324},"modelCalls":4,"toolCalls":7}
- **mega-pot**: Error: page.evaluate: Execution context was destroyed, most likely because of a navigation.
- **pico-pot**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":2},"model":"gpt-6.1-sol","elapsedMs":21068,"usage":{"input_tokens":31497,"output_tokens":719,"total_tokens":32216},"modelCalls":4,"toolCalls":5}
- **c3-led**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":3},"model":"gpt-6.1-sol","elapsedMs":24586,"usage":{"input_tokens":17993,"output_tokens":874,"total_tokens":18867},"modelCalls":4,"toolCalls":6}
- **classic-v1**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":2},"model":"gpt-6.1-sol","elapsedMs":27567,"usage":{"input_tokens":24458,"output_tokens":746,"total_tokens":25204},"modelCalls":6,"toolCalls":5}
- **classic-cv4**: Simulation is currently unavailable for ESP32 DevKit C V4. You can still build the circuit and write source code. Classic ESP32 requires the compatible patched native Velxio QEMU runtime; the official WASM emulator does not support this chip.
- **uno-dht**: AI did not generate requested source/parts.
- **uno-oled**: Error: No setup questions returned: {"type":"done","status":"success","reason":null,"changes":{"componentsAdded":0,"componentsRemoved":0,"componentsModified":0,"wiresAdded":0,"wiresRemoved":0,"firmwareWrites":0},"successfulTools":{"read_project":1,"search_components":2},"model":"gpt-6.1-sol","elapsedMs":23297,"usage":{"input_tokens":27228,"output_tokens":838,"total_tokens":28066},"modelCalls":4,"toolCalls":5}
- **uno-rtc**: AI did not generate requested source/parts.

## Evidence boundaries
A successful process start or firmware compile is not proof the design is electrically safe or functionally correct. No physical board was flashed. Serial output is recorded, not invented. Provider key/credentials and compiled binary payloads are excluded from this report. Detailed per-project activity, actual source and topology are recorded in the JSON artifact.
