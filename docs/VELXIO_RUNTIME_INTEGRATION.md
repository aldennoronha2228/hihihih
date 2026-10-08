# Velxio runtime integration — Uno milestone

WireUp keeps the existing `HardwareRuntime`, CPU artifact loader, compiler, canvas, serial monitor and project ownership. It now attaches selected upstream `PartSimulationRegistry` handlers to the same existing AVRSimulator instance; no second CPU engine or circuit store owns the project.

## Implemented scope

| Component | Reused upstream implementation | Required connections | Verified behavior |
| --- | --- | --- | --- |
| Potentiometer | `ComplexParts.ts` ADC helper | VCC to Uno 5V, GND to ground, SIG to A0–A5 | Real `analogRead()` values change with the control |
| Servo | `ComplexParts.ts` cycle-based pulse decoder | V+ to 5V, GND to ground, PWM to GPIO | Actual GPIO pulse widths update angle; no torque/current model |
| HC-SR04 | `SensorParts.ts` + `line/models/hc-sr04.ts` | 5V, ground, distinct TRIG/ECHO GPIO | Real `pulseIn()` sees distance-dependent timed echo |

`velxioParts.ts` translates canonical parts and wires into the upstream `PinTrace` interface, including breadboard groups and series resistor tracing. It refuses missing power/signal connections and disables the upstream unwired-servo fallback. ADC and sensor updates reuse upstream helpers. Cleanup occurs on stop, restart, element replacement, project changes and disposal.

The existing LED and rail-aware pushbutton behaviors remain.

## Additional verified board/component combinations

- Nano and Mega: rotary potentiometer, servo pulse decoding, and HC-SR04 echo timing passed real compiled-firmware tests. Nano A6/A7 remain analog-only.
- Mega A8–A15: the existing avr8js ADC configuration now includes the ATmega2560 MUX5 channel bank and sixteen channels. A15 was verified with real `analogRead()` firmware.
- Pico and Pico W: rotary potentiometer uses the upstream RP2040 ADC path, with 3V3/GND power and exposed GP26–GP28 input. Real firmware and control-change tests passed using UART0 (`Serial1`).
- Slide potentiometer: original Wokwi pins were verified and added to the canonical catalog. Uno ADC readings and control changes passed. The generalized slider adapter on other boards is not advertised as verified.

Pico servo and HC-SR04 remain disabled. Direct 5V echo into a 3.3V input must not be presented as safe; a verified level-shifting integration is still needed. Pico W wireless and onboard CYW43 LED remain unavailable.

A transient Windows project-file replacement lock found during testing now retries atomic replacement briefly without switching to non-atomic writes.

## Lifecycle

- `HardwareRuntime.run`: validate and load actual compiler artifact; attach selected part behavior; start the existing CPU.
- `registerElement`: attach late-mounted components and release replaced ones.
- `updateProject`: stop simulation when topology changes; forward property-only changes to actual part models.
- `stop` / `dispose`: remove event listeners and line leases; preserve truthful stopped results.
- Runtime results expose actual peripheral attachment state, values and support warnings.

## Verification and limitations

Real compiled firmware tests passed for potentiometer ADC, servo pulse response, and HC-SR04 pulse/echo. Stop/restart/reload and an unwired-servo case are included. Existing upstream behavior is not electrical safety certification. Analog current, mechanical loads, acoustic interference and broader peripheral families remain out of scope.

## RGB and DHT22 extension

- Uno/Nano/Mega now use the original `ComplexParts.ts` RGB handler with common-cathode COM-to-ground and wired R/G/B pins. A small upstream fix preserves actual PWM duty after a digital-edge callback, rather than flashing each channel at 255. Real `analogWrite(64/128/192)` firmware tests passed on all three boards. Common-anode rendering is not supported by this adapter; channel resistors and power budgets remain necessary.
- Uno/Nano/Mega DHT22 uses `ProtocolParts.ts` and the existing timed-line model. The installed Adafruit `DHT.h` reader compiled and returned 50%/25°C, then 65%/18°C after control changes, on all three boards. The earlier custom `pulseIn()` decoder was not a valid protocol test. Timing fidelity remains limited by the original model; this does not certify physical behavior.
- These new parts remain disabled on Pico/Pico W pending their own timing and power-level tests. Element replacement during a pending DHT/HC response stops the AVR before releasing the lease.

## Uno I²C display and sensor integration

The current Uno adapter connects the existing AVR TWI controller to a runtime-local upstream `BusRegistry`, using the actual canonical wiring as its resolver. Original registration hooks are redirected only during synchronous model attachment and restored in `finally`; no duplicate controller, decoder, or simulator is created.

Verified original models include SSD1306 I²C, LCD1602/LCD2004 I²C, MPU6050, DS1307 and DS3231. Real firmware tests cover OLED ACK/pixels, LiquidCrystal text, MPU device identity, and RTC register writes/reads. Correct SDA=A4, SCL=A5, power and ground are required. Address changes reattach targets; collision diagnostics are surfaced. Unwired devices must not acknowledge.

These paths are enabled only on Uno. MPU motion accuracy, RTC physical oscillator characteristics, LCD busy timing, other board buses, and electrical safety are not certified.

## Uno SSD1306 hardware SPI

The eight-pin SSD1306 now reuses the original SPI model through the same runtime-local bus registry and the existing AVR SPI controller. Connect DATA to D11, CLK to D13, distinct CS/DC GPIOs, and appropriate VIN/3V3 plus ground. Protocol selection is validated; four-pin OLED remains I²C-only. Real compiled SPI firmware renders pixels and passes stop/restart, with the I²C regression also passing. RST wiring is validated, but the upstream model does not emulate the RST pad; reset fidelity must not be claimed. SD cards, RFID and other SPI peripherals remain unintegrated. The original models retain their documented limitations. Peripheral pins were read from the actual registered Wokwi/Velxio elements before catalog enablement.

## Uno BMP280

BMP280 now reuses the original ProtocolParts register model through the existing local I²C bus. Its actual element pins are SDA/SCL/GND/VCC. The integration requires 3.3V and ground with Uno A4/A5, supports address 0x76/0x77, and exposes bounded temperature (-40–85°C) and pressure (300–1100 hPa) controls. Real Adafruit BMP280 library firmware read 24°C/1013.25 hPa, then updated to 30°C/950 hPa after changing controls and restarting. Sensor accuracy and electrical safety are not physically verified; other boards/SPI remain unenabled.

## Additional Uno sensors and examples

The original photoresistor AO model, NTC beta-divider model, and PIR digital-input model are now attached on Uno. Real firmware tests verify light/temperature ADC changes and a motion-triggered digital HIGH. Photoresistor DO is only an indicator path; PIR's three-second pulse uses browser wall time, not guest-cycle timing. These are explicit modeling limitations.

All 321 examples are dynamically classified using their actual canonical mapping and selected-board model coverage: currently 45 have simulation-ready hardware, 38 open with partial support, and 238 remain blocked by real import/pin/component limitations. Opening keeps original firmware and dependencies; readiness is not a claim that every example has been compiled/run. The normal project compile/run flow is reused. See `SIMULATION_INTEGRATION_BACKLOG.md` for the complete 172-component inventory and remaining bus/analog/model work.

Run:

```powershell
npx playwright test tests/uno-peripherals.spec.ts --workers=1
python -m pytest backend/tests/test_uno_sensor_controls.py -q
```
