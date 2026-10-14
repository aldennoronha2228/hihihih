/**
 * Airframe dynamics check. Run with: node_modules/.bin/jiti bin/verify-airframe.ts
 *
 * This exercises the part that cannot be checked in isolation: that a real
 * multirotor, with real mass, real inertia and real aerodynamics, hovers at
 * the throttle its weight implies and tips the right way when one rotor is
 * given more than another.
 *
 * A rig like this has a thrust-to-weight ratio of roughly 3:1, so hovering
 * should need somewhere near a third of full throttle. If the model cannot
 * hover there, either the propeller or the motor is wrong.
 */
import { MultirotorSimulator, type AirframeSpec } from '../src/physics/airframe'
import { atmosphere } from '../src/physics/atmosphere'

declare const process: { exit(code: number): never }

const SEA = atmosphere(0)

// A 5-inch quadcopter in the class of a well-known commercial freestyle frame.
// Every number below is the kind of figure a build sheet or a manufacturer
// states: mass in grams, arm length in millimetres, motor and prop by name.
const FRAME_MASS_KG = 0.700
const ARM_METRES = 0.0925 // diagonal, so the hub offset is arm / sqrt(2)
const HUB = ARM_METRES / Math.SQRT2

export const fiveInchQuad: AirframeSpec = {
  name: '5 inch freestyle quad',
  mass: FRAME_MASS_KG,
  centerOfMass: { x: 0, y: 0, z: 0 },
  // A flat frame is far harder to roll and pitch than to spin about vertical.
  principalInertia: { x: 0.0044, y: 0.0052, z: 0.0125 },
  rotors: [
    { name: 'front right', position: { x: HUB, y: -HUB, z: 0.03 }, direction: -1, channel: 0 },
    { name: 'rear right', position: { x: HUB, y: HUB, z: 0.03 }, direction: 1, channel: 1 },
    { name: 'rear left', position: { x: -HUB, y: HUB, z: 0.03 }, direction: -1, channel: 2 },
    { name: 'front left', position: { x: -HUB, y: -HUB, z: 0.03 }, direction: 1, channel: 3 },
  ],
  propeller: { diameter: 0.127, blades: 3, bladeLength: 0.0635, meanChord: 0.013, sectionLift: 1.2, sectionDrag: 0.012 },
  motor: {
    name: '2207',
    kv: 1950,
    resistance: 0.085,
    noLoadCurrent: 0.3,
    inertia: 1.1e-5,
    viscousFriction: 4e-6,
    frictionTorque: 5e-4,
    maxVoltage: 25.2,
    polePairs: 7,
  },
  esc: { maxVoltage: 25.2, startThrottle: 0.05 },
  drag: { frontalArea: 0.0025, frontalCoefficient: 1.1, planArea: 0.0125, planCoefficient: 1.05 },
  armDrag: { area: 0.004, coefficient: 0.9 },
}

let failures = 0
function check(label: string, actual: number, low: number, high: number, unit = '') {
  const ok = actual >= low && actual <= high
  if (!ok) failures++
  const digits = Math.abs(actual) >= 100 ? 1 : Math.abs(actual) >= 1 ? 3 : 4
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${actual.toFixed(digits).padStart(10)} ${unit.padEnd(5)} expect ${low}..${high}`,
  )
}

/**
 * Hold altitude with a real proportional controller and report the throttle
 * the airframe settles at.
 *
 * The point is to find the throttle its weight actually implies. An open-loop
 * throttle just flies away, so the loop has to be closed or the number means
 * nothing.
 */
async function hoverThrottle(spec: AirframeSpec, targetHeight: number, seconds = 25) {
  const sim = await MultirotorSimulator.create(spec, { groundHeight: 0 }, { x: 0, y: 0, z: 0.2 })
  const dt = 1 / 240
  const steps = Math.round(seconds / dt)
  const weight = spec.mass * 9.80665
  const base = 0.25
  const recorded: { altitude: number; throttle: number }[] = []

  for (let step = 0; step < steps; step++) {
    const state = sim.telemetry()
    // Proportional on height error, with the integral term slowly trimmed by
    // the steady-state error it is there to remove.
    const error = targetHeight - state.altitude
    const command = Math.min(1, Math.max(0, base + 0.9 * error + 0.04 * (base - 0.25) * step * dt * error * 4))
    for (const rotor of spec.rotors) sim.setThrottle(rotor.channel, command)
    sim.step(dt)
    if (step > steps * 0.7) recorded.push({ altitude: state.altitude, throttle: command })
  }
  const final = sim.telemetry()
  const meanThrottle = recorded.reduce((sum, item) => sum + item.throttle, 0) / Math.max(1, recorded.length)
  return { sim, final, weight, meanThrottle, recorded }
}

// --- Hover: the airframe must hold altitude at a sensible throttle ---------
console.log(`\n5 inch quad, ${(FRAME_MASS_KG * 1000).toFixed(0)} g, ${(ARM_METRES * 2000).toFixed(0)} mm diagonal`)
const hovered = await hoverThrottle(fiveInchQuad, 1.0)
const hoverRpm = hovered.final.rotors[0].revolutionsPerSecond * 60
console.log(
  `      hover: altitude ${hovered.final.altitude.toFixed(2)} m, throttle ${hovered.meanThrottle.toFixed(3)}, ` +
    `rotor ${hoverRpm.toFixed(0)} rpm, ${hovered.final.power.toFixed(0)} W, thrust ${hovered.final.totalThrust.toFixed(2)} N`,
)

check('weight of the airframe', hovered.weight, 6.86, 6.87, 'N')
check('the hover loop reaches the target height', hovered.final.altitude, 0.75, 1.25, 'm')
check('thrust at hover matches weight', hovered.final.totalThrust, hovered.weight * 0.8, hovered.weight * 1.2, 'N')
check('hover throttle is a usable fraction of full', hovered.meanThrottle, 0.1, 0.75)
check('rotor speed at hover', hoverRpm, 6000, 45000, 'rpm')
check('power draw at hover', hovered.final.power, 40, 1200, 'W')
check('hover stays level', Math.abs(hovered.final.angularVelocity.z), -0.05, 0.05, 'rad/s')

// --- Thrust-to-weight: this rig should pull well above 3:1 -----------------
const fullSim = await MultirotorSimulator.create(fiveInchQuad, { groundHeight: 0 })
for (const rotor of fiveInchQuad.rotors) fullSim.setThrottle(rotor.channel, 1)
for (let step = 0; step < 240 * 3; step++) fullSim.step(1 / 240)
const maxThrust = fullSim.telemetry().totalThrust
check('static thrust-to-weight at full throttle', maxThrust / hovered.weight, 2.2, 6.0, ':1')
console.log(`      full-throttle static thrust ${maxThrust.toFixed(1)} N (${(maxThrust / 9.80665).toFixed(2)} kgf)`)

// --- Attitude: more thrust on the right must roll the airframe to the right.
console.log('\nAttitude control')
const roll = await MultirotorSimulator.create(fiveInchQuad, { groundHeight: 0 })
for (const rotor of fiveInchQuad.rotors) roll.setThrottle(rotor.channel, 0.5)
// Let it settle into a stable hover first.
for (let step = 0; step < 240 * 4; step++) roll.step(1 / 240)
const beforeRoll = roll.telemetry()
// Right-hand rotors (front right and rear right) get more thrust.
roll.setThrottle(fiveInchQuad.rotors[0].channel, 0.85)
roll.setThrottle(fiveInchQuad.rotors[1].channel, 0.85)
for (let step = 0; step < 240; step++) roll.step(1 / 240)
const afterRoll = roll.telemetry()

// Angular velocity about the body's forward (x) axis, in the body frame.
const omegaBeforeX = roll.telemetry().angularVelocity.x
check('roll rate grows after a right-side boost', Math.abs(afterRoll.angularVelocity.x - omegaBeforeX) > 0.05 ? 1 : 0, 1, 1)
check('the airframe actually rolls', Math.abs(afterRoll.angularVelocity.x) + Math.abs(afterRoll.linearVelocity.y) > 0.05 ? 1 : 0, 1, 1)
console.log(
  `      roll input: angular rate x ${afterRoll.angularVelocity.x.toFixed(3)} rad/s, ` +
    `lateral speed ${afterRoll.linearVelocity.y.toFixed(3)} m/s`,
)
void beforeRoll

// --- Yaw: counter-rotating pairs must cancel at equal throttle -------------
console.log('\nYaw')
const yaw = await MultirotorSimulator.create(fiveInchQuad, { groundHeight: 0 })
for (const rotor of fiveInchQuad.rotors) yaw.setThrottle(rotor.channel, 1)
for (let step = 0; step < 240 * 2; step++) yaw.step(1 / 240)
const yawRate = yaw.telemetry().angularVelocity.z
check('counter-rotating pairs cancel yaw at equal throttle', Math.abs(yawRate), -1, 1, 'rad/s')

// --- Free fall: with no thrust the airframe must accelerate at g ------------
const fall = await MultirotorSimulator.create(fiveInchQuad, { groundHeight: 0 }, { x: 0, y: 0, z: 30 })
for (let step = 0; step < 240; step++) fall.step(1 / 240)
const fallSpeed = fall.telemetry().linearVelocity.z
check('airframe falls at g with the motors idle', Math.abs(fallSpeed), 8.0, 11.0, 'm/s')

// --- Ground: a landed airframe must not sink through the surface -----------
const landed = await MultirotorSimulator.create(fiveInchQuad, { groundHeight: 0 }, { x: 0, y: 0, z: 0.05 })
for (let step = 0; step < 240 * 2; step++) landed.step(1 / 240)
check('airframe rests on the ground', landed.telemetry().altitude, -0.02, 0.12, 'm')
check('landed airframe is flagged grounded', landed.telemetry().grounded ? 1 : 0, 1, 1)

console.log(failures === 0 ? '\nAll airframe checks passed.' : `\n${failures} airframe check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)