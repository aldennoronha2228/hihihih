# Features derived from all Velxio examples

Evaluated source collection: 321 examples, snapshot SHA256 recorded in example-analysis.json. Every record lists effective board, components, language, declared/inferred dependencies, canonical validation and blockers. Analysis is not proof of electrical safety, successful compilation or simulation.

Current classification: 6 selected starters, 33 further canonical candidates, 282 blocked references. 64 examples passed structural canonical validation; 257 did not. Findings include 184 unresolved-pin-layout records, 53 unverified dependencies, 110 unavailable runtimes, 22 multi-file workspaces, 51 unsupported-language records, 8 multiboard projects, 85 unsupported-component records and 39 network/radio requirements (counts overlap).

## Applied now
- Six revision-validated starter copies with original firmware and recorded source provenance; real resistors retained in button/LED circuits.
- Board-ID/pin alias normalization instead of assuming every endpoint named arduino-uno really denotes an Uno.
- Pico onboard LED clarification: GPIO25 is not an exposed Pico header pin, so the incompatible external LED layout is omitted from that starter.
- Agent `search_example_requirements` tool reads the entire analysis collection and returns relevant parts, dependencies and known gaps. Agent instructions use this to plan prototypes and report unsupported capabilities honestly.
- Home cards create editable independent project copies without model/API calls.

## Next backend/runtime features and workspace contracts for z.ai
1. **Verified pin and power schemas:** sensors/displays require accurate power levels, ground, address, bus pins, polarity and shared bus relationships. Expand only from real component metadata; reject unknown endpoints rather than guess.
2. **Libraries and project files:** explicit dependency manifests; per-project allowlisted library installation/versioning; multiple firmware and driver files with safe paths, board language modes and compiler adapters. UI needs file tree, dependency status and missing-library diagnostics.
3. **Sensor and peripheral runtime:** ADC input bridge, I2C/SPI devices, PWM/servo/buzzer, IR medium, storage and display drivers must connect to actual emulation. UI needs controllable sensor inputs and measured outputs; placement alone does not qualify as support.
4. **Native/multiboard execution:** remote ESP32/Linux sessions, per-board artifacts, independent clocks, UART/I2C bridge and coordinated start/stop. Preserve project isolation and failed-runtime statuses.
5. **Mixed signal:** explicit ngspice-to-MCU ADC/digital coupling; digital gates, semiconductors, op-amps and sources admitted only with real models. Keep existing standalone solver limitations visible.
6. **Networking/storage:** supported MQTT/WiFi/radio/network gateway, sandboxed filesystem/card state, and testable round trips. Never claim BLE or a camera works because an upstream sketch exists.
7. **Circuit checks:** wire batch validation, series LED resistance, power-net conflict rules and firmware-pin consistency. Examples with mismatches are references requiring correction, not templates to copy blindly.

Workspace UI files are owned by z.ai and were not edited for this feature. Parent implementation adds only the home sample section and backend interfaces. Preserve upstream AGPL attribution and original source licensing.
