# RC car prototype: what exists, what is verified, what is missing

WireUp project `dc7ee0d488ab414aa4c79fd4113d3fd4` ("An Rc Car"), revision 9.

## Circuit (verified)

- Board: Arduino Nano (ATmega328P), chosen because the catalog's `servo` part is only simulated on
  Uno/Nano/Mega.
- Catalog parts: two `potentiometer` inputs (throttle -> A0, steering -> A1), `servo` on D3,
  `motor-driver-l293d` on D6-D11 with the motor rail on VIN, and a `stepper-motor` as the drive
  actuator.
- 25 wires written in one atomic `wire_circuit` batch. Validation returned `valid: true` with no
  errors and no warnings; the 5 V and GND nets resolved to single rails.
- Firmware: pot -> servo angle (65-115 deg, centre 90 deg) and -> a full-step two-phase sequence
  through the L293D with the step interval mapped from throttle magnitude.
- `compile_firmware` ran the real Arduino CLI (`arduino:avr:nano:cpu=atmega328`): 4094 bytes of
  flash, 246 bytes of RAM, 0 errors, Intel HEX artifact `7ee1fd273b11427aabbbab64bd8a0fc5`.

## Models (built from dimensioned specs)

See `docs/MODEL_PIPELINE.md` for the pipeline and the per-part source list. Eleven parts plus the
assembly are exported; every catalog-typed part is dimensioned from a manufacturer datasheet and
carries its source URL and its uncertainty in `public/models/3d/manifest.json`.

## Physics (implemented, partly verified)

`src/physics/vehicle.ts` + `bin/verify-vehicle.ts`, run with
`node_modules\.bin\jiti bin/verify-vehicle.ts`. All checks pass. The verified chain is:

ESC pulse (1.0-2.0 ms) -> drive voltage -> brushed motor V = I*R + Ke*w -> torque scaled by the
4.167:1 gear train at 85% efficiency -> tire slip -> force saturating at mu*N -> chassis
integration. Verified behaviours: ESC neutral/full/reverse mapping, servo endpoints and its
published 0.17 s/60 deg speed limit, standstill staying still, the motor reaching 98% of its
computed no-load speed, the gearbox reducing speed by the specified ratio, a drag-limited top
speed of 7.72 m/s against an ideal 7.97 m/s, no energy creation, steering direction, and finite
state under abuse.

Two physics bugs were found and fixed by these checks, both of which produced wrong motion while
looking correct:

1. The SI torque constant was computed as `kv * 2*pi/60` instead of `9.55 / kv`, which overstated
   torque by four orders of magnitude and made the motor unusable.
2. Yaw inertia came out of the profile in gram-units (0.015 kg*m^2 became 15), so the chassis
   behaved as if it were ballast.

A centre of mass 6 mm behind the wheelbase midpoint also made the vehicle oversteer-unstable in the
tire model; it now sits 5 mm ahead of the midpoint, which is where a car with its motor behind the
axle belongs.

## Known limitations, stated plainly

- **Lateral dynamics are not a validated handling model.** Under large lock at low speed the
  single-track model develops slip angles past 0.5 rad and stops predicting a believable cornering
  line. It stays finite, but it must not be read as a validated tire model. It needs a friction
  ellipse and the `m*vx*r_dot` / `m*vy*r_dot` yaw terms before it can be.
- **The physics profile is not yet consumed by the app.** The viewer renders the manifest; it does
  not load `profiles.json`.
- **Firmware PWM is not yet wired to the vehicle simulator.** The linchpin used for the drone work
  is real and available - `pollPwmRegisters` publishes the actual AVR OCR duty cycle - but the RC
  firmware drives the L293D with `digitalWrite` stepping, so there is no continuous throttle duty
  to read. Until the firmware emits a servo-style throttle pulse, nothing upstream can drive this
  model.
- **Catalog gaps.** WireUp has no brushed DC motor, no ESC and no radio receiver. The circuit uses
  the catalog `stepper-motor` through the L293D as an honest stand-in and says so in the firmware
  header; the real motor, ESC and receiver are unmodelled integration points and are recorded as
  such in `profiles.json` under `integration_gaps`.
- **Not verified in a browser.** `run_simulation` needs a hardware workspace open on the project in
  a browser; none was, so no runtime result is claimed.
- `public/models/3d/esp32-s3.glb` is an older asset from the drone work with no spec behind it. It
  is no longer referenced by the manifest and should be either given a spec or removed.
