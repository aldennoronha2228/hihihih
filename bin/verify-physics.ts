/**
 * Physics self-check. Run with: node_modules/.bin/jiti bin/verify-physics.ts
 *
 * Two kinds of check live here, and the distinction matters:
 *
 *  1. Scaling laws. Thrust must go as rho*n^2*D^4, power as rho*n^3*D^5, and
 *     torque must come out of power over shaft speed. These follow from the
 *     algebra, so they are exact tests of the implementation independent of
 *     any uncertain blade-section coefficient.
 *
 *  2. Absolute agreement. A propeller's thrust coefficient depends on the
 *     blade section's lift coefficient at its operating angle of attack, which
 *     is the least certain number in the model and varies between designs.
 *     So absolute thrust is only checked against a propeller whose geometry is
 *     documented well enough to be worth trusting.
 *
 * A failure here means the model or the algebra is broken. It does not mean a
 * given airframe will fly; that depends on the design.
 */
import { atmosphere } from '../src/physics/atmosphere'
import { evaluatePropeller, solidity, discArea } from '../src/physics/propeller'
import type { PropellerSpec } from '../src/physics/propeller'
import { stepMotor, createMotorState, escDriveVoltage, freeSpeed, torqueConstant } from '../src/physics/motor'
import type { MotorSpec } from '../src/physics/motor'

declare const process: { exit(code: number): never }

let failures = 0
function check(label: string, actual: number, low: number, high: number, unit = '') {
  const ok = actual >= low && actual <= high
  if (!ok) failures++
  const digits = Math.abs(actual) >= 100 ? 1 : Math.abs(actual) >= 1 ? 3 : 5
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${actual.toFixed(digits).padStart(11)} ${unit.padEnd(5)} expect ${low}..${high}`,
  )
}

const sea = atmosphere(0)

// --- Atmosphere: ISA reference values from the standard tables -------------
console.log('\nAtmosphere (ICAO standard atmosphere reference values)')
check('sea level density', sea.density, 1.2249, 1.2251, 'kg/m3')
check('sea level temperature', sea.temperature, 288.14, 288.16, 'K')
check('5 km density', atmosphere(5000).density, 0.7361, 0.7362, 'kg/m3')
check('11 km density (tropopause)', atmosphere(11000).density, 0.3639, 0.3640, 'kg/m3')
check('20 km density (stratosphere)', atmosphere(20000).density, 0.0880, 0.0881, 'kg/m3')
check('density must fall with altitude', atmosphere(2000).density / sea.density < 0.95 ? 1 : 0, 1, 1)
check('speed of sound at sea level', sea.speedOfSound, 340.29, 340.31, 'm/s')

// --- Scaling laws: exact algebraic properties ------------------------------
console.log('\nScaling laws (coefficient-independent)')
const prop: PropellerSpec = { diameter: 0.254, blades: 2, bladeLength: 0.127, meanChord: 0.1143, sectionLift: 1.0, sectionDrag: 0.015 }
console.log(
  `      10x4.5 prop: disc ${(discArea(prop) * 1e4).toFixed(0)} cm2, solidity ${solidity(prop).toFixed(3)}, ` +
    `CT_static ${evaluatePropeller(prop, 83.33, 0, sea).thrustCoefficient.toFixed(4)}`,
)

const base = evaluatePropeller(prop, 83.33, 0, sea) // 5000 rpm
check('thrust doubles rpm -> quadruples', evaluatePropeller(prop, 166.67, 0, sea).thrust / base.thrust, 3.95, 4.05)
// Scaling the whole rotor (blade geometry included, so solidity is held fixed)
// isolates the D^4 dependence. Scaling only the diameter would change the
// solidity and so would not test D^4 on its own.
const scaledHalf: PropellerSpec = { ...prop, diameter: 0.127, bladeLength: 0.0635, meanChord: 0.05715 }
check('half-size rotor gives 1/16 thrust', evaluatePropeller(scaledHalf, 83.33, 0, sea).thrust / base.thrust, 0.0605, 0.0635)
check('half-size rotor gives 1/32 power', evaluatePropeller(scaledHalf, 83.33, 0, sea).shaftPower / base.shaftPower, 0.0295, 0.0325)
check('thrust tracks air density', evaluatePropeller(prop, 83.33, 0, atmosphere(9000)).thrust / base.thrust, 0.379, 0.383)
check('power doubles rpm -> 8x', evaluatePropeller(prop, 166.67, 0, sea).shaftPower / base.shaftPower, 7.9, 8.1)
check('torque equals power over shaft speed', base.torque * 2 * Math.PI * 83.33, base.shaftPower * 0.999, base.shaftPower * 1.001, 'W')
check('shaft speed ties to rpm', base.tipSpeed, 0.254 * 83.33, 0.254 * 83.33 + 1e-9, 'm/s')

// A 10" prop cruises slowly; J = v/(nD) = 10/21.17 = 0.47, well inside the
// range where the rotor still makes useful thrust.
const cruise = evaluatePropeller(prop, 83.33, 10, sea)
check('thrust falls with advance ratio', cruise.thrust / base.thrust, 0.15, 0.75)
check('power falls with advance ratio', cruise.shaftPower / base.shaftPower, 0.05, 0.6)
check('efficiency stays below the momentum bound', cruise.efficiency, 0.1, 0.95)

// Above the maximum advance ratio the rotor is being driven backwards through
// the flow: it produces no thrust and still absorbs power.
const overspeed = evaluatePropeller(prop, 83.33, 25, sea)
check('rotor stops making thrust past Jmax', overspeed.thrust, -1e-9, 1e-9, 'N')
check('windmilling rotor still absorbs power', overspeed.shaftPower, 0, Infinity, 'W')
check('windmilling is flagged', overspeed.windmilling ? 1 : 0, 1, 1)

// --- Absolute agreement ----------------------------------------------------
// This is a plausibility check, not a calibration. Thrust follows from the
// blade section's lift coefficient at its operating angle of attack, which
// varies between real prop designs and is not derivable from the planform
// alone, so a single geometry here cannot be held to a tight tolerance.
console.log('\nAbsolute plausibility: 10x4.5 at 5000 rpm, sea level')
check('static thrust of a 10x4.5 at 5krpm', base.thrust / 9.80665, 0.5, 2.0, 'kgf')
check('efficiency at static is zero, not negative', base.efficiency, -1e-12, 1e-12)

// --- Motor and ESC ---------------------------------------------------------
console.log('\nMotor and ESC (2207 on a 5-inch quadcopter prop, a matched pair)')
// A 2207 on 6S with a 5x4.3x3 is the canonical freestyle quad combination.
const motor2207: MotorSpec = {
  name: '2207',
  kv: 1950,
  resistance: 0.085,
  noLoadCurrent: 0.3,
  inertia: 1.1e-5,
  viscousFriction: 4e-6,
  frictionTorque: 5e-4,
  maxVoltage: 25.2,
  polePairs: 7,
}
const prop5: PropellerSpec = { diameter: 0.127, blades: 3, bladeLength: 0.0635, meanChord: 0.013, sectionLift: 1.2, sectionDrag: 0.012 }
const esc6s = { maxVoltage: 25.2, startThrottle: 0.05 }

const ke = 60 / (2 * Math.PI * motor2207.kv)
const expectedFreeRpm = (((25.2 - motor2207.noLoadCurrent * motor2207.resistance) / ke) / (2 * Math.PI)) * 60
check('free speed matches the motor equation', freeSpeed(motor2207, 25.2) * 60, expectedFreeRpm * 0.999, expectedFreeRpm * 1.001, 'rpm')
check('free speed is below the Kv*V ceiling', freeSpeed(motor2207, 25.2) * 60, 30000, 1950 * 25.2, 'rpm')
check('torque constant is positive and sane', torqueConstant(motor2207), 0.025, 0.045, 'N.m/A')
check('ESC deadband produces no drive', escDriveVoltage(0.04, esc6s, motor2207), 0, 1e-9, 'V')
check('ESC full throttle reaches battery', escDriveVoltage(1.0, esc6s, motor2207), 25.2, 25.2, 'V')
check('ESC midpoint is half the battery', escDriveVoltage(0.525, esc6s, motor2207), 12.2, 13.0, 'V')

// Static thrust of a 5x4.3x3 on a 2207 at full 6S is about 1.2-1.5 kgf.
const full = evaluatePropeller(prop5, (1950 * 25.2 * 0.82) / 60, 0, sea)
check('static thrust of a 5in prop on a 2207', full.thrust / 9.80665, 1.0, 1.8, 'kgf')

// Spin-up. The rotor has a real time constant, so it must accelerate over a
// finite interval and settle, rather than jumping straight to speed.
let state = createMotorState()
const dt = 1e-5
let steps = 0
while (steps < 400000 && Math.abs(state.revolutionsPerSecond * 60 - 48000) > 60) {
  const load = evaluatePropeller(prop5, state.revolutionsPerSecond, 0, sea)
  state = stepMotor(motor2207, esc6s, prop5, state, 1, sea, load.torque, dt)
  steps++
}
check('rotor spins up and settles in a plausible time', steps * dt, 0.001, 1.0, 's')
check('loaded rotor settles below free speed', state.revolutionsPerSecond * 60, 40000, 49090, 'rpm')
check('settled current is realistic for a 2207', Math.abs(state.current), 1, 25, 'A')
check('speed is stable at equilibrium', Math.abs(state.revolutionsPerSecond * 60 - 48000) < 200 ? 1 : 0, 1, 1)

// Releasing the throttle must bring the rotor down through its own back-EMF,
// and must not carry it past zero into reverse rotation.
let down = state
steps = 0
while (down.revolutionsPerSecond > 0 && steps < 400000) {
  const load = evaluatePropeller(prop5, down.revolutionsPerSecond, 0, sea)
  down = stepMotor(motor2207, esc6s, prop5, down, 0, sea, load.torque, dt)
  steps++
}
check('rotor spins down when the throttle is released', down.revolutionsPerSecond, 0, 1e-9, 'rev/s')
check('rotor never turns backwards unpowered', down.revolutionsPerSecond >= 0 ? 1 : 0, 1, 1)

// Stall current: V/R with no back-EMF, which for a low-resistance motor is
// genuinely enormous. This is why quad ESCs are rated for large bursts.
let stalled = createMotorState()
stalled = stepMotor(motor2207, esc6s, prop5, stalled, 1, sea, 5, dt)
check('stalled motor draws V/R amps', stalled.current, 290, 300, 'A')

// --- Regression: a descending rotor must not gain phantom thrust ------------
// A rotor descending through still air sees a NEGATIVE advance ratio, and that
// is the normal case in flight. The thrust curve is quadratic in the ratio and
// grows without bound past its cutoff, so a one-sided guard would hand a
// slowly descending airframe an enormous, entirely fictitious force.
console.log('\nDescending rotor (negative advance ratio)')
const slowRotor = evaluatePropeller(prop5, 5, -0.5, sea)
check('barely turning descending rotor makes no thrust', slowRotor.thrust, 0, 1e-4, 'N')
check('barely turning rotor has clamped advance ratio', slowRotor.advanceRatio, -20, 20)
const descending = evaluatePropeller(prop5, 200, -6, sea)
check('descending rotor thrust stays bounded', descending.thrust, 0, 50, 'N')
check('descending rotor still makes some thrust', descending.thrust, 1e-3, 50, 'N')
check('descending rotor power stays finite', descending.shaftPower, 0, 5000, 'W')

// A rotor stopped with no drive must stay stopped rather than walking backwards
// on its own friction.
let idleState = createMotorState()
for (let i = 0; i < 100; i++) idleState = stepMotor(motor2207, esc6s, prop5, idleState, 0, sea, 0, dt)
check('an undriven idle rotor stays at zero', idleState.revolutionsPerSecond, 0, 1e-12, 'rev/s')

console.log(failures === 0 ? '\nAll physics checks passed.' : `\n${failures} physics check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)