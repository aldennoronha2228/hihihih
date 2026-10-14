# RC car prototype: what exists, what is verified, what is missing

WireUp project `dc7ee0d488ab414aa4c79fd4113d3fd4` ("An Rc Car"), revision 13.

## Circuit (verified)

- Board: Arduino Nano (ATmega328P), chosen because the catalog's `servo` part is only simulated on
  Uno/Nano/Mega.
- Catalog parts: two `potentiometer` inputs (throttle -> A0, steering -> A1), `servo` on D3,
  `motor-driver-l293d`, and a `stepper-motor` as the drive actuator on the canvas.
- Pin map: D6 -> EN1, D7/D8 -> IN1/IN2, D10 -> IN3, D9 -> IN4, D11 -> EN2. D6 and D11 are Timer0
  PWM outputs; EN2 was deliberately moved onto D11 so both drive channels get hardware PWM.
- Wire validation returned `valid: true` with no errors and no warnings after the rewire.
- `compile_firmware` ran the real Arduino CLI (`arduino:avr:nano:cpu=atmega328`): 4150 bytes of
  flash, 229 bytes of RAM, 0 errors, artifact `b4c69dba2dc74e03be9eaec751f14177`.

## Firmware -> physics link (this is the part that makes it an RC car)

The firmware no longer steps the L293D. It does what a real H-bridge does: direction on
IN1/IN2 and IN3/IN4, **speed from hardware PWM on the EN pins**. That matters because the AVR
simulator polls the real OCR registers and publishes the duty cycle
(`pollPwmRegisters` -> `pinManager.updatePwm` in vendor/velxio/frontend/src/simulation/
AVRSimulator.ts). The throttle the physics sees is therefore the duty the firmware wrote, at the
emulator's own clock, not a scripted value.

`src/physics/firmware-drive.ts` is the bridge: duty on D6 becomes throttle, duty on D3 becomes the
servo pulse width over a 20 ms frame, direction comes from the IN pins, and the vehicle integrates
on simulated time only. If the emulator clock does not advance, nothing moves - there is a test
for exactly that.

## Physics (implemented, verified where it is claimed)

`src/physics/vehicle.ts` + `src/physics/firmware-drive.ts`, run with
`node_modules\.bin\jiti bin/verify-vehicle.ts`. 19 checks pass.

Verified: ESC mapping in both directions, servo endpoints and its published 0.17 s/60 deg speed
limit, standstill, the motor reaching 98% of its computed no-load speed, the 4.167:1 gearbox, a
drag-limited top speed of 7.72 m/s against an ideal 7.97 m/s, no energy creation, steering
direction, tire force saturation, finite state under abuse, and the firmware-driven run: zero duty
leaves the car still, half duty reaches 3.86 m/s, full duty 7.72 m/s, reverse direction produces
-7.72 m/s, and a stalled clock produces no motion.

Bugs these checks caught, all of which produced wrong motion while looking correct:

1. The SI torque constant was `kv * 2*pi/60` instead of `9.55 / kv`, overstating torque by four
   orders of magnitude.
2. Yaw inertia was emitted in gram units, so the chassis behaved as if it were ballast.
3. ESC reverse supplied zero drive voltage, so the car could never reverse.
4. The motor speed clamp used the signed supply voltage, pinning reverse speed to zero.
5. A centre of mass 6 mm behind the wheelbase midpoint made the vehicle oversteer-unstable; it now
   sits 5 mm ahead, which is where a car with its motor behind the axles belongs.

## Models

See `docs/MODEL_PIPELINE.md`. Eleven dimensioned parts plus the assembly are exported; every
catalog-typed part is dimensioned from a manufacturer datasheet and carries its source URL and
uncertainty in `public/models/3d/manifest.json`.

## Known limitations, stated plainly

- **Lateral dynamics are not a validated handling model.** Under large lock at low speed the
  single-track model develops slip angles past 0.5 rad and stops predicting a believable cornering
  line. It stays finite, but it must not be read as a validated tire model. It needs a friction
  ellipse and the `m*vx*r_dot` / `m*vy*r_dot` yaw terms.
- **The 3D view still does not render motion.** `src/components/hardware-3d-view.tsx` draws the
  published models and states in its own footnote that it does not simulate physics. Nothing calls
  `RcDriveBridge` yet. That is the remaining gap between "the physics works" and "the car drives on
  screen".
- **Catalog gaps.** WireUp has no brushed DC motor, no ESC and no radio receiver. The circuit uses
  the catalog `stepper-motor` through the L293D as an honest stand-in and says so in the firmware
  header; the real motor, ESC and receiver are unmodelled integration points, recorded as
  `integration_gaps` in `profiles.json`.
- **Not verified in a browser.** `run_simulation` needs a hardware workspace open on the project in
  a browser; none was, so no runtime measurement is claimed. The compile artifact is real.
- `public/models/3d/esp32-s3.glb` is an older asset from the drone work with no spec behind it. It
  is no longer referenced by the manifest.
