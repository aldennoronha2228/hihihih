/** Scratch diagnostic. Not part of the verification suite. */
import { MultirotorSimulator, type AirframeSpec } from '../src/physics/airframe'

const ARM = 0.0925
const HUB = ARM / Math.SQRT2
const spec: AirframeSpec = {
  name: '5 inch freestyle quad',
  mass: 0.7,
  centerOfMass: { x: 0, y: 0, z: 0 },
  principalInertia: { x: 0.0044, y: 0.0052, z: 0.0125 },
  rotors: [
    { name: 'front right', position: { x: HUB, y: -HUB, z: 0.03 }, direction: -1, channel: 0 },
    { name: 'rear right', position: { x: HUB, y: HUB, z: 0.03 }, direction: 1, channel: 1 },
    { name: 'rear left', position: { x: -HUB, y: HUB, z: 0.03 }, direction: -1, channel: 2 },
    { name: 'front left', position: { x: -HUB, y: -HUB, z: 0.03 }, direction: 1, channel: 3 },
  ],
  propeller: { diameter: 0.127, blades: 3, bladeLength: 0.0635, meanChord: 0.013, sectionLift: 1.2, sectionDrag: 0.012 },
  motor: { name: '2207', kv: 1950, resistance: 0.085, noLoadCurrent: 0.3, inertia: 1.1e-5, viscousFriction: 4e-6, frictionTorque: 5e-4, maxVoltage: 25.2, polePairs: 7 },
  esc: { maxVoltage: 25.2, startThrottle: 0.05 },
  drag: { frontalArea: 0.0025, frontalCoefficient: 1.1, planArea: 0.0125, planCoefficient: 1.05 },
  armDrag: { area: 0.004, coefficient: 0.9 },
}

const sim = await MultirotorSimulator.create(spec, { groundHeight: 0 }, { x: 0, y: 0, z: 0.2 })
const anyBody = sim as unknown as { body: { mass(): number; principalInertia(): unknown; localCom(): unknown } }
console.log('rapier mass        ', anyBody.body.mass())
console.log('principal inertia  ', JSON.stringify(anyBody.body.principalInertia()))
console.log('local com          ', JSON.stringify(anyBody.body.localCom()))

const dt = 1 / 240
for (const rotor of spec.rotors) sim.setThrottle(rotor.channel, 0.5)
for (let i = 0; i < 240 * 3; i++) {
  sim.step(dt)
  if (i % 120 === 0) {
    const t = sim.telemetry()
    console.log(
      `t=${(i * dt).toFixed(2)} alt=${t.altitude.toFixed(3)} vz=${t.linearVelocity.z.toFixed(3)} ` +
        `vxy=(${t.linearVelocity.x.toFixed(2)},${t.linearVelocity.y.toFixed(2)}) ` +
        `w=(${t.angularVelocity.x.toFixed(2)},${t.angularVelocity.y.toFixed(2)},${t.angularVelocity.z.toFixed(2)}) ` +
        `rpm=${(t.rotors[0].revolutionsPerSecond * 60).toFixed(0)} T=${t.totalThrust.toFixed(2)} P=${t.power.toFixed(0)}`,
    )
  }
}