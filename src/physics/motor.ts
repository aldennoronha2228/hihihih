/**
 * Brushless outrunner motor and electronic speed controller.
 *
 * The chain that matters here is:
 *
 *   firmware writes a PWM duty cycle
 *     -> ESC maps it to a drive voltage (with a real idle band and a throttle
 *        curve, because an ESC does not drive a motor from 0 volts)
 *       -> the motor's electrical equation produces back-EMF-limited current
 *        -> that current makes torque
 *         -> the torque minus the propeller's reaction torque accelerates the
 *            rotor against its own inertia
 *
 * The result is that a prop spins up with a real time constant, spins down when
 * the firmware drops the throttle, and that the thrust it makes is the thrust
 * the aerodynamics in propeller.ts demand. Nothing here is a lookup from
 * "throttle" to "thrust".
 */

import type { AtmosphereSample } from './atmosphere'
import { evaluatePropeller, type PropellerSpec } from './propeller'

export type MotorSpec = {
  /** Name, for diagnostics. */
  name?: string
  /**
   * Velocity constant, RPM per volt. Hobby datasheets quote 2207 as "2207 KV",
   * meaning 2207 RPM per volt. This is the number that fixes the free speed.
   */
  kv: number
  /** Phase-to-phase resistance, ohms. */
  resistance: number
  /** No-load (free-running) current at full voltage, amps. */
  noLoadCurrent: number
  /**
   * Motor torque constant, N*m per amp. For a well-matched brushless motor
   * this follows from Kv and the number of pole pairs; the vendor value is
   * preferred when given because manufacturing spread makes the relation only
   * approximate.
   */
  torqueConstant?: number
  /** Rotor inertia, kg*m^2. Sets the acceleration. */
  inertia: number
  /** Coulomb friction of bearings and brushes, N*m, constant with speed. */
  frictionTorque?: number
  /**
   * Viscous and iron loss torque per unit speed, N*m/(rad/s). Roughly
   * proportional to speed for windage and hysteretic loss.
   */
  viscousFriction?: number
  /** Peak drive voltage, volts. */
  maxVoltage: number
  /** Current the bridge will push when back-EMF exceeds the supply, amps. */
  maxRegenCurrent?: number
  /** Number of magnetic pole pairs. Used to derive the torque constant. */
  polePairs?: number
}

export type EscSpec = {
  /** Commanded voltage when the throttle is at or above `fullThrottle`. */
  maxVoltage: number
  /**
   * Fraction of the throttle range that does nothing. Real ESCs hold the
   * motor stopped until the signal crosses a start threshold, and many ramp
   * from there. 0.05 to 0.12 is typical.
   */
  startThrottle: number
  /** Full-scale throttle, in the same duty units the firmware writes. */
  fullThrottle?: number
}

export type MotorState = {
  /** Commanded throttle, 0..1, already mapped out of the ESC deadband. */
  throttle: number
  /** Drive voltage the ESC applies, volts. */
  driveVoltage: number
  /** Commanded speed, revolutions per second. Signed: negative spins backwards. */
  speed: number
  /** Actual speed, revolutions per second. */
  revolutionsPerSecond: number
  /** Phase current, amps. */
  current: number
  /** Net torque on the rotor, N*m. */
  torque: number
  /** Reaction torque the propeller is applying back into the shaft, N*m. */
  propellerTorque: number
  /** True once the rotor is turning faster than the prop can load. */
  freeRunning: boolean
}

/** Torque constant derived from the velocity constant when not given. */
export function torqueConstant(motor: MotorSpec): number {
  if (motor.torqueConstant !== undefined && motor.torqueConstant > 0) return motor.torqueConstant
  // Kv is RPM/V. With p pole pairs, omega = Kv * V * 2 * pi / 60 rad/s.
  // Kt = p * lambda where lambda is the flux linkage, and omega = V / (Kt/p * ...)
  // which gives Kt = 9.55 * p / Kv for SI units of N*m/A.
  const pairs = motor.polePairs ?? 7
  return (9.5493 * pairs) / Math.max(1, motor.kv)
}

/**
 * Map a firmware throttle signal to the voltage the ESC actually applies.
 *
 * `signal` is a 0..1 duty cycle. Anything at or below the start threshold
 * produces an unpowered, coasting motor rather than a slow crawl, because the
 * diodes in the bridge would otherwise hold the windings shorted and the rotor
 * would dither in place.
 */
export function escDriveVoltage(signal: number, esc: EscSpec, motor: MotorSpec): number {
  const duty = Number.isFinite(signal) ? Math.min(1, Math.max(0, signal)) : 0
  if (duty <= esc.startThrottle) return 0
  const span = 1 - esc.startThrottle
  if (span <= 0) return esc.maxVoltage
  const fraction = (duty - esc.startThrottle) / span
  const ceiling = Math.max(0.1, Math.min(esc.maxVoltage, motor.maxVoltage))
  return fraction * ceiling
}

/**
 * Advance the rotor by `dt` seconds.
 *
 * `loadTorque` is whatever resists the shaft, normally the propeller's
 * reaction torque at its current speed. It is returned from the previous step
 * because torque and speed are mutually dependent: more speed means more load,
 * which means less speed.
 */
export function stepMotor(
  motor: MotorSpec,
  esc: EscSpec,
  propeller: PropellerSpec,
  state: MotorState,
  signal: number,
  air: AtmosphereSample,
  loadTorque: number,
  dt: number,
): MotorState {
  if (!(dt > 0)) return state

  const driveVoltage = escDriveVoltage(signal, esc, motor)
  const kt = torqueConstant(motor)
  const ke = 60 / (2 * Math.PI * Math.max(1, motor.kv)) // V per rad/s
  const speed = state.revolutionsPerSecond
  const omega = speed * 2 * Math.PI

  // Motor electrical equation: V = I*R + Ke*omega. When the back-EMF exceeds
  // the drive the current goes negative and the motor regenerates, which is
  // what brakes the rotor. Clamping that current to zero would let the rotor
  // sail past free speed and stay there, since nothing would be pulling it back.
  const backEmf = ke * omega
  const resistance = Math.max(0.001, motor.resistance)
  const rawCurrent = (driveVoltage - backEmf) / resistance
  const driveLimit = driveVoltage > 0 ? driveVoltage / resistance : 0
  const regenLimit = motor.maxRegenCurrent ?? motor.noLoadCurrent * 2
  const clampedCurrent = Math.max(-regenLimit, Math.min(driveLimit, rawCurrent))

  // Losses are what make a motor draw current while coasting, and what finally
  // limits top speed. Coulomb friction is speed-independent; windage and iron
  // loss grow with speed.
  const lossTorque = (motor.frictionTorque ?? 0) + (motor.viscousFriction ?? 0) * Math.abs(omega)
  const electricalTorque = kt * clampedCurrent
  // Losses oppose motion. At a dead stop with no drive there is nothing to
  // oppose, and letting friction pick a direction would walk the rotor
  // backwards on its own.
  const moving = speed > 1e-9 ? 1 : speed < -1e-9 ? -1 : Math.sign(electricalTorque)
  const netTorque = electricalTorque - loadTorque - lossTorque * moving

  const acceleration = netTorque / Math.max(1e-7, motor.inertia)
  let revolutionsPerSecond = speed + acceleration * dt

  // An undriven rotor can be slowed to a stop by its own back-EMF but it cannot
  // drive itself backwards through it. Landing on zero is the physical stop;
  // letting an explicit step carry the value negative would spin it up in
  // reverse with nothing driving it.
  if (driveVoltage === 0 && speed > 0 && revolutionsPerSecond <= 0) revolutionsPerSecond = 0

  // Propeller load at the new speed, so the next step sees the correct demand.
  const propellerResult = evaluatePropeller(propeller, revolutionsPerSecond, 0, air)

  return {
    throttle: driveVoltage > 0 ? Math.min(1, signal) : 0,
    driveVoltage,
    speed,
    revolutionsPerSecond,
    current: clampedCurrent,
    torque: electricalTorque,
    freeRunning: driveVoltage > 0 && Math.abs(backEmf) >= driveVoltage - 1e-6,
    propellerTorque: propellerResult.torque,
  }
}

/** Fresh motor state, stopped. */
export function createMotorState(): MotorState {
  return {
    throttle: 0,
    driveVoltage: 0,
    speed: 0,
    revolutionsPerSecond: 0,
    current: 0,
    torque: 0,
    propellerTorque: 0,
    freeRunning: false,
  }
}

/**
 * Free-running speed of the motor at a given voltage, ignoring the propeller.
 *
 * At no load the motor still draws its iron and friction current, so the speed
 * settles where that current's resistive drop leaves the remaining voltage to
 * be balanced by back-EMF: V = I0*R + Ke*omega.
 *
 * Used to size a design and to report where a prop-loaded rotor saturates.
 */
export function freeSpeed(motor: MotorSpec, voltage: number): number {
  const ke = 60 / (2 * Math.PI * Math.max(1, motor.kv)) // V per rad/s
  const drop = motor.noLoadCurrent * Math.max(0.001, motor.resistance)
  const omega = Math.max(0, voltage - drop) / ke
  return omega / (2 * Math.PI)
}