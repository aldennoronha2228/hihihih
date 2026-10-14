# Handoff: physics+cad branch

You are picking up work on the `physics+cad` branch of the WireUp repo at
`D:\hihihih`. A previous agent got the physics core working and verified it, but
was moving slowly. Read this whole file before touching anything. Most of it is
hard-won knowledge: several of the findings below cost real debugging time and
will cost it again if rediscovered the hard way.

## The user's request, verbatim intent

The user wants a branch where WireUp can simulate a real drone:

1. **CAD.** Blender MCP makes the CAD. Convert it to something browser-renderable,
   store it somewhere, and surface it in WireUp. WireUp currently only shows
   Arduino components and wires in 2D; that must become **a 2D option and a 3D
   option**. The 3D option shows the Blender geometry, and it must reflect the
   same components and wiring that the 2D view has.
2. **Physics.** A real physics simulation with **actual weights**, complete
   physics, and a real environment.
3. **The coupling that matters most**: spinning motors must produce **actual
   torque turning an actual fan**, and the airframe must fly *because of its own
   design and its firmware*, not because something toggled a "fly" flag.
4. **Nothing faked.** The user said this twice and meant it. If a number cannot
   be derived from geometry, firmware, or a published source, it must be
   labelled as such, not quietly invented.
5. Work across **Blender MCP and WireUp together**.
6. **Do not commit or push.** Branch exists locally; leave it uncommitted.
7. Make it as **wide/range-able** as possible, not drone-only.

## Current state

Branch `physics+cad`, nothing committed. Working tree:

```
 M package.json          (added @dimforge/rapier3d-compat, @react-three/drei)
 M package-lock.json
?? bin/verify-physics.ts, bin/verify-airframe.ts
?? src/physics/*.ts
```

Run the checks with jiti (already installed):

```powershell
node_modules\.bin\jiti bin\verify-physics.ts
node_modules\.bin\jiti bin\verify-airframe.ts
```

`bin/verify-physics.ts` **currently passes 100%.** `bin/verify-airframe.ts`
**currently fails 7 checks** — see "Known broken" below.

## What exists and is verified

`src/physics/` — pure TypeScript, no React, no DOM dependency, so it is testable
directly under node. This was a deliberate choice: physics that can only be
verified through a browser is physics nobody verifies.

- **`atmosphere.ts`** — ICAO standard atmosphere. Density, pressure, temperature,
  speed of sound by altitude; dynamic pressure; Sutherland viscosity.
- **`propeller.ts`** — blade-element momentum theory. Given geometry and rpm,
  returns thrust, shaft power, reaction torque, efficiency. Includes
  `inducedVelocityRatio`, which solves the momentum-theory quadratic so power
  cannot violate the second law of thermodynamics.
- **`motor.ts`** — BLDC motor + ESC. `V = I*R + Ke*omega`, back-EMF, torque
  constant from Kv, rotor inertia, Coulomb + viscous losses, regenerative
  braking, ESC deadband.
- **`airframe.ts`** — `MultirotorSimulator`. Rapier rigid body, rotor thrust
  applied at each real hub via `addForceAtPoint`, reaction torque about the
  vertical axis, body/plan drag, arm drag, wind, ground contact.

Dependencies added: `@dimforge/rapier3d-compat@0.21.0` (WASM inlined as base64,
so no Vite config needed) and `@react-three/drei@10.7.9`.

## The linchpin: firmware actually drives the physics

This was verified before anything was built, and it is the fact the whole design
rests on. **It is real, not approximate.**

`vendor/velxio/frontend/src/simulation/AVRSimulator.ts:1456` — `pollPwmRegisters`
polls the **actual AVR OCR registers** written by the firmware's `analogWrite()`
and publishes the real duty cycle and simulated time via
`pinManager.updatePwm(pin, duty, timeMs)`.

Consequences, all verified in the source:

- Hardware PWM on Uno/Nano/Mega reaches `onPinChangeWithTime` as real edges
  (`timerOverridePin` → `writeGpio` → port listener → `firePinChangeWithTime`).
- So motor duty can be read from **real firmware output**, at real simulated
  timestamps. Motor RPM is then *derived*, never commanded.
- `runtime.getSamples(pin, sinceMs)` gives the edge ring; `simulated_ms` and
  `clock_hz` give the authoritative simulated clock. **Drive physics from
  `simulated_ms`, not wall time**, or the two will drift apart.

## Bugs found and fixed. Do not reintroduce these.

These were all caught by the verification scripts, not by reading code. Each
produced wrong physics while looking correct.

1. **Atmosphere used the wrong exponent.** I wrote the barometric formula with
   `(gamma * M) / (LAPSE * R)` — the adiabatic exponent. Correct is
   `(GRAVITY * M) / (LAPSE * R_UNIVERSAL)` ≈ 5.2559. The wrong one made density
   *increase* with altitude (1.225 at sea level → 1.31 at 11 km). Fixed, now
   matches ISA reference values to 4 decimal places.

2. **Efficiency exceeded 1.** I had thrust and power as two independent
   empirical curves. Near max advance ratio, power fell faster than thrust, so
   `thrust * velocity / power` hit 2.47 — impossible. Replaced with
   momentum-theory-derived power: `inducedVelocityRatio()` solves
   `CT = (pi/2) * lambda * (J + lambda)`, and shaft power covers the whole flow
   column plus profile drag. Efficiency is now bounded by construction at
   `J/(J+lambda) <= 1`.

3. **Negative advance ratio produced phantom thrust — the worst one.** A rotor
   descending sees a *negative* advance ratio, and that is the normal case in
   flight. The thrust curve `(1 - ratio^2)^2` was guarded only for
   `ratio >= 1`, so negative ratios fell through and the quadratic exploded. A
   drone descending at 0.2 m/s gained 33 mN of imaginary thrust and the whole
   airframe was fired into the sky at 391 m/s. Guard must be on
   `Math.abs(ratio) < 1`, plus `clampedAdvanceRatio()` bounds the singular
   zero-rpm case. **There is a regression test for this — keep it.**

4. **Rotor ran away past free speed.** Clamping current to >= 0 stopped
   regenerative braking, so once back-EMF exceeded the supply the rotor
   freewheeled forever above free speed. Fixed by allowing negative current,
   bounded by `maxRegenCurrent`.

5. **Rotor coasted backwards.** Explicit integration carried speed through zero
   into reverse. Fixed with a physical zero-crossing clamp. Also, coulomb
   friction was picking a direction at a dead stop and walking the rotor
   backwards unpowered — fixed by only opposing real motion.

6. **Loss model was invented.** `noLoadCurrent * (0.05 + 0.25 * speed/1000)` was
   a made-up formula large enough to stall the rotor. Replaced with explicit
   `frictionTorque` (Coulomb) + `viscousFriction` (per rad/s).

7. **Tip loss was over-penalised.** An exponential `1 - exp(-pi/B)` term dropped
   absolute thrust ~30%. Removed it and made `sectionLift` the honest
   calibration knob, with the model's uncertainty documented. After removing it,
   a 10x4.5 lands at 1.03 kgf at 5000 rpm against ~1.2-1.5 kgf published — and
   a 5" prop on a 2207 lands at 1.72 kgf. Good agreement.

8. **`setAdditionalMassProperties` is a no-op in this Rapier build.** All four
   API forms (descriptor and body, mass and properties) read back mass 0. The
   airframe was effectively massless (0.0004 kg from collider density) and
   accelerated at 143 m/s². **Verified directly**: mass only comes from collider
   density. The code now builds real geometry (central plate + one arm per
   rotor), computes total volume, and sets density = mass / volume. This is the
   better design anyway: a flat quad is genuinely much harder to roll and pitch
   than to spin about vertical, and the plate-plus-arms shape produces that
   anisotropy by itself. `principalInertia` is now optional and derived.

## Known broken right now

1. **`bin/verify-airframe.ts` fails 7 checks.** The mass bug (#8) was only just
   fixed and has **not been re-run**. Fix `telemetry()` first if needed
   (I added an `inertia` field to `AirframeState`; confirm `principalInertia()`
   exists on the Rapier body or drop the field).
2. **`principalInertia` in `AirframeSpec`** is optional now; the test file
   `bin/verify-airframe.ts` still sets it. Decide whether to keep the override
   or remove it and rely on derived geometry.
3. **`verify-airframe.ts` hover test** was badly written (it computed a control
   error then discarded it, making it open-loop so the drone just flew away).
   I rewrote it as a closed loop but have not run it since the mass fix.
4. The roll/attitude checks are weak — they assert "something changed" rather
   than "it rolled the correct way by a physically sensible amount". Tighten
   them, or accept them as smoke tests and say so.

## Design decisions already made

- **Rapier for the rigid body, hand-written aerodynamics.** Rapier does
  mechanics (quaternion, inertia, contacts). Nothing off the shelf does
  propeller aerodynamics, so that is ours. This split is deliberate.
- **Pure TS physics core, no React.** Testable under node via jiti.
- **No `useHardwareWorkspace()` extraction yet.** The explore agent found it is a
  real prerequisite for a 3D viewport (35 `useState` hooks in one component,
  150 ms publish timer, pin positions polled from the DOM). The canonical
  subscription pattern to copy is `runtime.subscribeInstrumentation()`, as used
  in `src/components/hardware-instruments.tsx:47`.
- **3D viewport must be a slot prop, not a direct import**, following
  `schematicSlot` in `hardware-workspace.tsx`, so `React.lazy` keeps `three` out
  of the initial bundle. Add `'3d'` to `HardwareWorkspaceView`
  (`hardware-workspace.tsx:20`) and a tab at `:486`.
- **Put `.glb` files in `public/`**, not `src/` — matches the ngspice WASM
  precedent and the `import.meta.glob('/public/...')` pattern already used at
  `hardware-workspace.tsx:49`. No Vite config change needed for `.glb`.

## Repo facts worth knowing

- `three@0.186.1` and `@react-three/fiber@9.8.1` were **already dependencies**,
  used only by `src/components/ui/gradient-orb.tsx`. There is **no** existing
  glTF/GLTFLoader/model-loading code anywhere. The 3D pipeline is greenfield.
- `package.json` build is `tsc -b && vite build`. **`noUnusedLocals` and
  `noUnusedParameters` are on** — `tsc -b` hard-fails on a dead import. This bit
  me repeatedly.
- `tsconfig.app.json` has `lib: ["ES2023", "DOM"]` — **no `DOM.Iterable`**, no
  WebWorker types. Relevant if physics is moved to a worker.
- Backend is Python/FastAPI; `npm run dev:api` serves it on 127.0.0.1:8000. It
  was **not running** during this work.
- Neither Blender MCP nor the WireUp backend was connected during this work, so
  **nothing has been validated end-to-end in a browser**. That is the biggest
  gap in the current state.
- `properties` on a component is a **closed** dict — `backend/hardware.py:802`
  rejects unknown keys. A per-component 3D model/scale field needs a real
  top-level component field, or an edit to `backend/catalog/component-pins.json`.
  `schema_version: 1` is not branched on anywhere, so bumping it is cheap.
- Wires carry **no geometry** and `HardwareWire` endpoints reject extra keys
  (`hardware.py:834`). Do not add geometry to the wire model — sample pin
  positions and build a `TubeGeometry` from a curve instead.
- `pinPosition()` at `hardware-workspace.tsx:387` already resolves rotation-aware
  world pin positions. Hoist and reuse it; it solves the 3D cable problem.

## Suggested order of work

1. Get `verify-airframe.ts` green. The mass fix is in but unverified. Nothing
   else is trustworthy until hover produces thrust equal to weight at a sane
   throttle.
2. Sanity-check the derived inertia tensor against published values for a real
   5" quad (Ixx ≈ Iyy ≈ 0.0044, Izz ≈ 0.0125 kg·m² for ~700 g / 185 mm). If the
   geometry-derived tensor is off, scale the shape.
3. Tighten the attitude tests to assert direction and magnitude, not just "it
   moved".
4. Wire firmware PWM → `setThrottle`. Read duty from `pinManager` PWM values or
   the `samples` ring, convert to a throttle channel per rotor, and prove a real
   Arduino sketch makes a real quad hover. **This is the single most important
   integration and it is currently unbuilt.**
5. 3D view: `'3d'` in `HardwareWorkspaceView`, lazy-loaded slot prop, Rapier
   scene driving from `MultirotorSimulator`.
6. Blender pipeline: model → glTF → `public/models/3d/` → manifest → loaded per
   component, with the physics profile (mass, CoM, inertia, arm geometry) carried
   alongside rather than guessed from the mesh.
7. Widen beyond drones: the airframe spec is already a generic rotor array, so
   tricopters, hexacopters, octocopters and coaxial designs fall out of data.

## Honesty requirements

The user was emphatic that nothing is faked. Concretely:

- Every physics parameter traces to geometry, firmware output, or a published
  figure. Say which, in the comment.
- Where a parameter is genuinely uncertain — `sectionLift` is the main one —
  document the uncertainty rather than tuning it to hit a target and calling it
  calibrated.
- Distinguish "verified" from "implemented". The existing repo is careful about
  this (`RELEASE_STATUS.md`) and the user will expect the same standard here.
- If Blender or the backend is not running, say so rather than claiming a
  browser-verified result.

## Commands

```powershell
node_modules\.bin\jiti bin\verify-physics.ts     # currently passing
node_modules\.bin\jiti bin\verify-airframe.ts    # currently failing, see above
npm run build                                    # tsc -b then vite build
npm run lint                                     # oxlint
```

**Do not commit or push.** Leave everything in the working tree on `physics+cad`.