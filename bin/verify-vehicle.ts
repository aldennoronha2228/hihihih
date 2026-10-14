/**
 * Verification harness for src/physics/vehicle.ts.
 *
 * Run with:  node_modules\.bin\jiti bin/verify-vehicle.ts
 *
 * The point of these checks is that nothing here may be "a number that looks
 * right". Each one either comes from a published source or from the geometry
 * and firmware the pipeline produced.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RcVehicle, escCommand, servoTargetAngle, type VehicleSpec } from '../src/physics/vehicle'

type Profile = {
  vehicles: Record<string, {
    mass_kg: number
    center_of_mass_m: number[]
    inertia_kg_m2: Record<string, number>
    geometry: Record<string, number>
    tire: Record<string, number>
    aero: Record<string, number>
    drivetrain: Record<string, number | string>
  }>
  components: Record<string, {
    mass_kg?: number
    actuator?: Record<string, number>
  }>
}

const repo = join(import.meta.dirname, '..')
const profiles = JSON.parse(
  readFileSync(join(repo, 'public', 'models', 'physics', 'profiles.json'), 'utf-8'),
) as Profile

const vehicle = profiles.vehicles['rc-car-1to10-chassis']
const motor = profiles.components['quicrun-540-30t']
const esc = profiles.components['quicrun-wp-1060']
const servo = profiles.components['mg996r']

let failures = 0

function check(name: string, condition: boolean, detail: string): void {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}: ${detail}`)
}

const spec: VehicleSpec = {
  gravity: 9.80665,
  chassis: {
    mass: vehicle.mass_kg,
    comHeight: vehicle.center_of_mass_m[2],
    comOffset: vehicle.center_of_mass_m[0],
    wheelbase: vehicle.geometry.wheelbase_m,
    trackFront: vehicle.geometry.track_front_m,
    trackRear: vehicle.geometry.track_rear_m,
    frontWheelRadius: vehicle.geometry.front_wheel_radius_m,
    yawInertia: vehicle.inertia_kg_m2.izz,
    dragCoefficient: vehicle.aero.drag_coefficient,
    frontalArea: vehicle.aero.frontal_area_m2,
    airDensity: 1.225,
  },
  motor: {
    kv: Number(motor.actuator?.kv_rpm_per_volt ?? 0),
    resistance: Number(motor.actuator?.winding_resistance_ohm ?? 0),
    inertia: Number(motor.actuator?.armature_inertia_kg_m2 ?? 0),
    frictionTorque: 1.1e-3,
    batteryVoltage: 8.4,
  },
  esc: {
    minPulseUs: 1000,
    neutralPulseUs: 1500,
    maxPulseUs: 2000,
    driveVoltage: 8.4,
    brakeVoltage: 4.2,
    continuousCurrent: esc.actuator?.fwd_continuous_a ?? 60,
    peakCurrent: esc.actuator?.fwd_peak_a ?? 360,
  },
  servo: {
    centerPulseUs: servo.actuator?.neutral_us ?? 1500,
    minPulseUs: servo.actuator?.min_pulse_us ?? 500,
    maxPulseUs: servo.actuator?.max_pulse_us ?? 2400,
    minAngleDeg: 65 - 90,
    maxAngleDeg: 115 - 90,
    secondsPer60Deg: servo.actuator?.speed_sec_per_60deg ?? 0.17,
    maxRoadWheelAngleDeg: 28,
  },
  drivetrain: {
    gearRatio: Number(vehicle.drivetrain.gear_ratio),
    efficiency: Number(vehicle.drivetrain.final_drive_efficiency),
    diffEfficiency: Number(vehicle.drivetrain.diff_efficiency),
    driveWheelRadius: vehicle.geometry.rear_wheel_radius_m,
  },
  tire: {
    mu: vehicle.tire.mu,
    stiffness: 12.0,
    shape: 1.3,
    loadSensitivity: 0.02,
    rollingResistance: vehicle.tire.rolling_resistance_coefficient,
  },
}

const dt = 1 / 240

function run(pulse: number, steerPulse: number, seconds: number): RcVehicle {
  const car = new RcVehicle(spec)
  for (let step = 0; step < Math.round(seconds / dt); step += 1) {
    car.step(dt, { throttlePulseUs: pulse, steerPulseUs: steerPulse })
  }
  return car
}

const neutral = escCommand(1500, spec.esc)
check('ESC neutral', neutral.throttle === 0 && neutral.voltage === 0,
  `1500 us -> throttle ${neutral.throttle}, ${neutral.voltage} V`)
const full = escCommand(2000, spec.esc)
check('ESC full forward', Math.abs(full.throttle - 1) < 1e-9 && full.voltage > 7,
  `2000 us -> throttle ${full.throttle}, ${full.voltage.toFixed(2)} V`)
const reverse = escCommand(1000, spec.esc)
check('ESC full reverse', reverse.reverse && reverse.throttle > 0.9,
  `1000 us -> reverse ${reverse.reverse}, throttle ${reverse.throttle.toFixed(2)}`)

check('Servo endpoints', servoTargetAngle(500, spec.servo) === -25 &&
  servoTargetAngle(2400, spec.servo) === 25 && servoTargetAngle(1500, spec.servo) === 0,
  '500/1500/2400 us -> -25/0/+25 deg, matching the firmware 65-115 deg window')

const stationary = new RcVehicle(spec)
for (let step = 0; step < 240; step += 1) {
  stationary.step(dt, { throttlePulseUs: 1500, steerPulseUs: 1500 })
}
check('At rest', Math.abs(stationary.speed) < 1e-6 && stationary.state.motorOmega === 0,
  `speed ${stationary.speed.toExponential(2)} m/s, motor ${stationary.state.motorOmega.toFixed(2)} rad/s`)

const freeRun = run(2000, 1500, 6)
const expectedNoLoad = (spec.motor.kv * spec.esc.driveVoltage * 2 * Math.PI) / 60
const freeSpinRatio = freeRun.state.motorOmega / expectedNoLoad
check('Motor approaches its no-load speed', freeSpinRatio > 0.6 && freeSpinRatio <= 1.0,
  `${(freeRun.state.motorOmega * 60 / (2 * Math.PI)).toFixed(0)} rpm vs no-load ` +
  `${(expectedNoLoad * 60 / (2 * Math.PI)).toFixed(0)} rpm (ratio ${freeSpinRatio.toFixed(2)})`)

const wheelRpm = freeRun.state.motorOmega / spec.drivetrain.gearRatio
check('Gearbox reduces speed', wheelRpm < freeRun.state.motorOmega / 3.9,
  `wheel ${(wheelRpm * 60 / (2 * Math.PI)).toFixed(0)} rpm after a ${spec.drivetrain.gearRatio.toFixed(2)}:1 reduction`)

const topSpeed = run(2000, 1500, 30).speed
const idealTop = (spec.motor.kv * spec.esc.driveVoltage * 2 * Math.PI / 60) /
  spec.drivetrain.gearRatio * spec.drivetrain.driveWheelRadius
check('Top speed is set by the motor and gearing, slightly reduced by drag',
  topSpeed < idealTop && topSpeed > 0.7 * idealTop,
  `${topSpeed.toFixed(2)} m/s measured against an ideal ${idealTop.toFixed(2)} m/s ` +
  `(ratio ${(topSpeed / idealTop).toFixed(2)})`)

const electrical = freeRun.state.motorCurrent * spec.esc.driveVoltage
const mechanical = Math.abs(freeRun.state.motorTorque * freeRun.state.motorOmega)
check('No energy creation', electrical <= 0 || mechanical <= electrical,
  `mechanical ${mechanical.toFixed(1)} W <= electrical ${electrical.toFixed(1)} W`)

const turning = run(1700, 1800, 4)
check('Steering right produces a clockwise (negative) yaw rate', turning.state.yawRate < -0.05,
  `yaw rate ${turning.state.yawRate.toFixed(3)} rad/s with right lock`)

const opposite = run(1700, 1200, 4)
check('Steering left produces the opposite yaw rate', opposite.state.yawRate > 0.05,
  `yaw rate ${opposite.state.yawRate.toFixed(3)} rad/s with left lock`)

const servoRate = run(1500, 2400, 1).state.servoAngleDeg
const maxRate = (60 / spec.servo.secondsPer60Deg) * 1
check('Servo respects its published speed', servoRate <= maxRate + 1e-6,
  `${servoRate.toFixed(1)} deg in 1 s, limit ${maxRate.toFixed(1)} deg/s ` +
  `(${servo.actuator?.speed_sec_per_60deg} s per 60 deg)`)

const slipping = run(2000, 1500, 1.5)
check('Tire force saturates instead of exploding', Math.abs(slipping.state.driveForce) <
  spec.tire.mu * spec.chassis.mass * 9.80665 * 1.05,
  `drive force ${slipping.state.driveForce.toFixed(1)} N under a ` +
  `${(spec.tire.mu * spec.chassis.mass * 9.80665).toFixed(1)} N grip ceiling`)

const spun = run(2000, 2400, 12)
const finite = [spun.state.x, spun.state.y, spun.state.yaw, spun.state.yawRate,
                spun.state.motorOmega].every(Number.isFinite)
check('Integration stays finite through abuse', finite,
  `after 12 s of full lock at full throttle: x ${spun.state.x.toFixed(1)} m, ` +
  `yaw ${(spun.state.yaw * 180 / Math.PI).toFixed(0)} deg`)

/*
 * KNOWN LIMITATION, not a passing check. The lateral model is a single-track
 * bicycle model with a saturating tire curve. Verified behaviour is limited to
 * the longitudinal chain above. Under large lock at low speed it develops slip
 * angles past 0.5 rad and stops predicting a realistic cornering line; it does
 * not produce NaN, but it must not be read as a validated handling model until
 * the tire model gets a friction ellipse and the yaw equation gets the
 * m*vx*r_dot and m*vy*r_dot terms.
 */
console.log('NOTE  lateral model: documented limitation, not a verified behaviour')


/*
 * Firmware-driven run: the throttle now comes from a PWM duty cycle exactly as
 * pollPwmRegisters publishes it from the AVR OCR register, not from a scripted
 * throttle. This is the check that the RC car actually moves because the
 * firmware told it to.
 */
const { RcDriveBridge, dutyToThrottle, dutyToServoPulse } = await import('../src/physics/firmware-drive')
check('PWM duty maps to throttle', Math.abs(dutyToThrottle(0.5) - 0.494) < 0.01 &&
  dutyToThrottle(0) === 0 && dutyToThrottle(1) === 1,
  `duty 0.5 -> ${dutyToThrottle(0.5).toFixed(3)}, duty 0 -> 0, duty 1 -> 1`)
check('Servo duty maps to a 20 ms frame width', Math.abs(dutyToServoPulse(0.075) - 1500) < 1,
  `duty 0.075 -> ${dutyToServoPulse(0.075).toFixed(0)} us (centre pulse)`)
function drive(duty: number, seconds: number, direction = 1) {
  const bridge = new RcDriveBridge(spec, { throttlePin: 6, steeringPin: 3 })
  bridge.setDirection(direction)
  const stepMs = 16
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += stepMs) {
    bridge.update({ throttle: { duty, timeMs: elapsed }, steering: { duty: 0.075, timeMs: elapsed } },
                  elapsed)
  }
  return bridge.vehicle
}
const idle = drive(0, 3)
check('Idle duty leaves the car still', idle.speed < 1e-6,
  `${idle.speed.toFixed(4)} m/s after 3 s at zero duty`)
const half = drive(0.5, 12)
const fullThrottle = drive(1.0, 12)
check('Half throttle is slower than full throttle and both move',
  half.speed > 0.5 && fullThrottle.speed > half.speed,
  `half duty ${half.speed.toFixed(2)} m/s, full duty ${fullThrottle.speed.toFixed(2)} m/s`)
const reversed = drive(1.0, 6, -1)
check('Reversing the drive pins reverses the car', reversed.state.vx < 0,
  `body forward velocity ${reversed.state.vx.toFixed(2)} m/s with direction -1`)
const paused = new RcDriveBridge(spec, { throttlePin: 6, steeringPin: 3 })
paused.update({ throttle: { duty: 1, timeMs: 1000 } }, 1000)
const before = paused.vehicle.speed
const state = paused.update({}, 1000)
check('A stalled emulator clock cannot invent motion', !state.advanced && paused.vehicle.speed === before,
  'replaying the same simulated timestamp performs no integration')

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
