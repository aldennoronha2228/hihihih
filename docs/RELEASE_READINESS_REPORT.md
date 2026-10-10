# WireUp release-readiness report

## Verdict

**Conditional/no unrestricted release sign-off.** Twenty distinct fresh designs were attempted with a real AI model. Following reproduced bug fixes and isolated retries, all twenty designs have actual generated circuit/source and successful compilation evidence across the retained attempts. Eighteen have browser run/stop evidence; classic ESP32 DevKit V1/C V4 remain compile-only, with native execution blocked. This is not twenty flawless first-attempt builds, exhaustive component validation, or physical hardware certification.

## Scope and method

- Running app: `Downloads/simply`, not the earlier `wireup` checkout.
- Real configured chat probes for Groq, NVIDIA, Bedrock and Azure. Azure was selected for the twenty model-driven builds after actual chat success.
- Each design starts as a fresh board-only project. The harness does not insert a template or predetermined source; it sends a natural-language request, receives model-generated MCQs, supplies AI-choice answers while retaining the exact board, and executes the real project tools.
- Firmware compilation uses the installed arduino-cli toolchain. Simulation runs in the actual mounted browser runtime, with recorded serial output and stop behavior.
- Examples can be retrieved by the agent as references; that is part of the app's normal workflow, not manually seeded test code.
- Two complete twenty-case runs and five additional fresh targeted builds were executed. The second run still had failures; targeted retries must not be counted as an initial-pass result.

## Provider results

| Provider | Actual observed results | Release interpretation |
|---|---|---|
| Azure / gpt-6.1-sol | Plain chat and real circuit/firmware builds completed | Verified provider for this test matrix; not a guarantee under every request |
| Groq / openai/gpt-oss-120b | Plain chat succeeded | Full twenty-project matrix was not repeated on Groq; quota and tool output reliability remain separate |
| NVIDIA / z-ai/glm-5.3 | First chat probe succeeded; subsequent probe timed out at 20 seconds | Intermittent; not reliable release-ready provider evidence |
| Bedrock / zai.glm-5 | Authorization failed in both probe runs | Blocked by credentials/permissions/regional model access; configuration flag is not readiness |

## Twenty distinct designs

The outcome column uses the latest successful build/verification available for each design, not just the first attempt. Failed attempts remain in the separate reports.

| # | Design | Board | Final retained verification |
|---:|---|---|---|
| 1 | External LED blink with 220Ω resistor | Uno | Generated, compiled, browser run/stop |
| 2 | Pushbutton-controlled external LED | Nano | Generated, compiled, browser run/stop |
| 3 | Common-cathode RGB cycle with three resistors | Mega | Targeted fresh retry compiled and ran after compiler-busy failure |
| 4 | Servo sweep | Uno | Generated, compiled, browser run/stop; servo motion inspected separately |
| 5 | Ultrasonic distance monitor | Nano | Generated, compiled, browser run/stop |
| 6 | A15 potentiometer-controlled brightness | Mega | Generated, compiled, browser run/stop |
| 7 | GP26 ADC potentiometer | Pico | Generated, compiled, browser run/stop |
| 8 | External GP2 LED and UART | Pico W | Targeted fresh build compiled; initial runtime assertion timed out. Subsequent actual browser check ran/stopped the same artifact after board-element registration fix |
| 9 | External GPIO2 LED with UART0 | ESP32-C3 | Generated, compiled, browser run/stop; actual board SVG/pins verified |
| 10 | GPIO4 button and GPIO5 LED | ESP32-S3 | Generated, compiled, browser run/stop; actual board SVG/pins verified |
| 11 | GPIO2 LED and Serial | Classic ESP32 DevKit V1 | Generated and compiled; simulation unavailable |
| 12 | Potentiometer voltage monitor | Classic ESP32 DevKit C V4 | Generated and compiled; simulation unavailable |
| 13 | Adafruit DHT22 serial monitor | Uno | Generated, compiled, browser run/stop; numerical serial output inspected separately |
| 14 | Four-pin I²C OLED Hello display | Uno | Targeted fresh retry generated, compiled and ran after false display requirement detection |
| 15 | LiquidCrystal I²C LCD Hello | Uno | Generated, compiled, browser run/stop; displayed text inspected separately |
| 16 | DS1307 register clock | Uno | Generated, compiled, browser run/stop |
| 17 | MPU6050 identity/acceleration | Uno | Generated, compiled, browser run/stop |
| 18 | BMP280 temperature/pressure | Uno | Targeted fresh retry generated, compiled and ran after browser navigation failure |
| 19 | DIP channels and rotary encoder | Uno | Targeted fresh retry generated, compiled and ran after browser navigation failure |
| 20 | Photoresistor + NTC + joystick | Uno | Generated, compiled, browser run/stop |

Twenty projects cannot exercise every one of the 172 catalog entries. Logic networks, motor drivers, unintegrated UART/SPI parts, and every board/peripheral combination are outside this matrix. Existing individual runtime tests establish selected additional behavior, not universal support.

## Initial failure rates and fixes

- First twenty-case run: 11 browser simulations completed, one additional compile-only build completed, eight other failures. Some prompts were falsely classified as not builds.
- Second twenty-case run: 13 browser simulations completed, two compile-only builds completed, five other failures.
- Five targeted fresh retries: four browser simulations completed; Pico W generated/compiled but hit a runtime wait failure, followed by a successful direct browser verification of that exact saved artifact.

Reproduced fixes:
1. Negated secondary instructions such as “do not run simulation” no longer cancel affirmative build intent.
2. Serial-only output and explicit no-display instructions no longer require a physical LCD/OLED.
3. Actual catalog display names are included when matching requirements; SSD1306 is recognized as an OLED rather than rejected for not containing the word “display” in its ID.
4. ESP32-C3/S3 now render the original `velxio-esp32` variant elements instead of unavailable `wokwi-*` tags. Actual SVGs, pins and wire cards were verified at desktop/mobile sizes.
5. Pico W now uses its registered upstream board element instead of a placeholder.
6. Compiler-busy errors do not consume firmware correction attempts. Busy/timeouts remain visible; no fake compilation success is introduced.
7. Native unavailable-runtime detection handles an injected adapter without `.sessions` safely.
8. The Windows Uvicorn launcher exposes a supported Proactor factory instead of relying on deprecated event-loop policy APIs.
9. A stale blocked-example regression was updated to an actually blocked example, with its capability checked before asserting rejection.

## Regression and browser checks

The final post-fix deterministic backend gate passed **908 tests**, with ten actual hardware-toolchain cases deliberately excluded from that run. Before new regression tests were added, the repaired gate passed 903. The excluded cases are explicitly listed in `RELEASE_REGRESSION_AUDIT.md`; real firmware compilation in the live matrix is separate evidence, not a substitute for every excluded test.

Additional browser checks passed:
- Four C3/S3 actual diagram/pin/wire-detail tests across desktop/mobile.
- Actual generated servo motion, LCD text, DHT serial data and synchronized schematics.
- Direct Pico W simulation start/stop on the targeted generated artifact, with no browser alerts and a visible original board element.

Final TypeScript and Vite production build passed after these fixes. Existing oversized chunks and vendored direct-eval warnings remain. Lint warnings are described in the regression audit. A successful build is not unrestricted release sign-off.

## Evidence retention

- `docs/RELEASE_20_PROJECT_REPORT.md`: first complete run summary.
- `docs/RELEASE_20_PROJECT_REPORT-rerun.md`: second complete run summary.
- `docs/RELEASE_20_PROJECT_REPORT-targeted.md`: five targeted fresh attempts.
- `docs/RELEASE_REGRESSION_AUDIT.md`: initial regression failures and exact scope.
- `audit-artifacts/recovered-release-projects.json`: recovered actual project snapshots, without runtime tokens or binaries.
- Future detailed harness output uses `audit-artifacts/` because Playwright clears `test-results/` between runs. Earlier detailed event JSON/screenshots in test-results were lost when that directory was cleared; summaries and actual saved project state were recovered. This evidence loss is disclosed, not concealed.

## Remaining release blockers

- Classic ESP32 native firmware panics and lacks external GPIO integration. Hide or clearly label unavailable runtime; do not market classic ESP32 simulation as working.
- Bedrock authorization and intermittent NVIDIA availability remain unresolved.
- No complete project matrix on every provider. Twenty attempts use Azure after plain-chat probes.
- Some builds required retries; provider and browser navigation reliability needs further repeated-load testing.
- Simulation success is not physical safety, motor load, supply, analog accuracy, or all peripheral behavior verification.
- No physical board was flashed. Uploader tests are controlled-process/API safety tests only.
- Production deployment/auth/session behavior, user multi-tenancy and long-duration uptime are outside this local audit.

Recommended release scope: label verified board/peripheral combinations, use a tested provider, retain clear limitations, and keep unsupported simulation controls disabled. Do not announce “all boards/all components/perfect builds” based on this audit.
