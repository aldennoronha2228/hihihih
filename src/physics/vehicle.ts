/**
 * RC ground vehicle physics: brushed motor + ESC, steering servo, tires, chassis.
 *
 * Same contract as the drone modules: nothing here maps "throttle" straight to
 * "speed". The chain is
 *
 *   firmware PWM (a real duty cycle measured from the AVR OCR register, or the
 *   ESC's 1.0-2.0 ms throttle pulse width)
 *     -> ESC maps the pulse to a drive voltage and a direction/brake state
 *       -> the brushed motor's V = I*R + Ke*w equation limits current by
 *          back-EMF, so torque falls as the motor approaches free speed
 *         -> the drivetrain scales torque by the gear ratio and loses efficiency
 *           -> the tire converts slip into a force that saturates at mu*N
 *             -> the chassis integrates the resulting body forces
 *
 * Every parameter carries a source. Values without a source are design targets
 * and are named as such; nothing is inferred from mesh appearance. The vehicle
 * numbers come from public/models/physics/profiles.json, which is written by the
 * Blender pipeline from the dimensioned part specs.
 */

/** Simplified Pacejka-style tire: F = D * sin(C * atan(B * x)). */
export type TireSpec = {
  /** Peak friction coefficient. Design target for rubber on smooth asphalt. */
  mu: number
  /** Slip stiffness. B in the magic formula, 1 per unit slip. */
  stiffness: number
  /** Shape factor. C in the magic formula. */
  shape: number
  /** Vertical load sensitivity: mu falls as load rises. 1/m, design target. */
  loadSensitivity: number
  /** Rolling resistance coefficient. */
  rollingResistance: number
}

export type BrushedMotorSpec = {
  /** Velocity constant, RPM per volt. Derived from the published no-load rpm. */
  kv: number
  /** Armature resistance, ohms. Estimated; no vendor figure exists. */
  resistance: number
  /** Armature inertia, kg*m^2. Estimated for this motor class. */
  inertia: number
  /** Brush and bearing Coulomb friction, N*m. */
  frictionTorque: number
  /** Pack voltage at full charge, volts. */
  batteryVoltage: number
}

export type EscSpec = {
  /** Pulse width below this is full reverse, above is full forward, volts. */
  minPulseUs: number
  neutralPulseUs: number
  maxPulseUs: number
  /** Voltage the ESC passes to the motor at full forward throttle. */
  driveVoltage: number
  /** Braking voltage when the signal asks for brake. */
  brakeVoltage: number
  /** Continuous and peak current the bridge can push, amps. */
  continuousCurrent: number
  peakCurrent: number
}

export type SteeringServoSpec = {
  /** Pulse width at the mechanical centre, microseconds. */
  centerPulseUs: number
  minPulseUs: number
  maxPulseUs: number
  /** Servo angle at those limits, degrees, measured from the centre. */
  minAngleDeg: number
  maxAngleDeg: number
  /** Seconds per 60 degrees at the rated voltage. */
  secondsPer60Deg: number
  /** Road-wheel angle at the servo limits, degrees. Derived from the linkage. */
  maxRoadWheelAngleDeg: number
}

export type DrivetrainSpec = {
  /** Motor speed to wheel speed reduction, e.g. 50/12 = 4.1667. */
  gearRatio: number
  /** Final drive efficiency, 0..1. */
  efficiency: number
  /** Differential efficiency, 0..1. */
  diffEfficiency: number
  /** Wheel radius used for the drive wheels, metres. */
  driveWheelRadius: number
}

export type ChassisSpec = {
  mass: number
  /** Centre of mass height, metres. */
  comHeight: number
  /** Centre of mass offset from the wheelbase midpoint, metres, + forward. */
  comOffset: number
  wheelbase: number
  trackFront: number
  trackRear: number
  frontWheelRadius: number
  /** Yaw inertia, kg*m^2. Derived from the mass breakdown in the profile. */
  yawInertia: number
  /** Drag coefficient and frontal area. */
  dragCoefficient: number
  frontalArea: number
  /** Air density, kg/m^3, for the aero drag term. */
  airDensity: number
}

export type VehicleSpec = {
  chassis: ChassisSpec
  motor: BrushedMotorSpec
  esc: EscSpec
  servo: SteeringServoSpec
  drivetrain: DrivetrainSpec
  tire: TireSpec
  /** Rolling resistance coefficient for the non-driven wheels. */
  gravity: number
}

export type VehicleState = {
  x: number
  y: number
  yaw: number
  vx: number
  vy: number
  yawRate: number
  motorOmega: number
  wheelOmega: number
  servoAngleDeg: number
  steerAngleRad: number
  throttle: number
  motorCurrent: number
  motorTorque: number
  driveForce: number
  longitudinalSlip: number
  lateralSlipFront: number
  lateralSlipRear: number
  distance: number
}

export type VehicleInputs = {
  /** ESC throttle pulse width in microseconds, 1000-2000. */
  throttlePulseUs: number
  /** Steering servo pulse width in microseconds, 500-2400. */
  steerPulseUs: number
}

const GRAVITY = 9.80665
/**
 * The tire force curve is stiff enough that an explicit integrator needs a
 * short step. Requests larger than this are substepped rather than stretched.
 */
const MAX_SUBSTEP = 1 / 600

export function escCommand(pulseUs: number, esc: EscSpec): {
  throttle: number
  reverse: boolean
  brake: boolean
  voltage: number
} {
  if (pulseUs <= esc.neutralPulseUs) {
    const span = esc.neutralPulseUs - esc.minPulseUs
    const fraction = span > 0 ? (esc.neutralPulseUs - pulseUs) / span : 0
    // Below neutral a real ESC reverses the motor's polarity, which in this
    // model is the same as applying the drive voltage with the opposite sign.
    return { throttle: clamp(fraction, 0, 1), reverse: fraction > 0.02, brake: false,
             voltage: -esc.driveVoltage * clamp(fraction, 0, 1) }
  }
  const span = esc.maxPulseUs - esc.neutralPulseUs
  const fraction = span > 0 ? (pulseUs - esc.neutralPulseUs) / span : 0
  return { throttle: clamp(fraction, 0, 1), reverse: false, brake: false,
           voltage: esc.driveVoltage * clamp(fraction, 0, 1) }
}

export function servoTargetAngle(pulseUs: number, servo: SteeringServoSpec): number {
  if (pulseUs <= servo.centerPulseUs) {
    const span = servo.centerPulseUs - servo.minPulseUs
    const fraction = span > 0 ? (servo.centerPulseUs - pulseUs) / span : 0
    return servo.minAngleDeg * clamp(fraction, 0, 1)
  }
  const span = servo.maxPulseUs - servo.centerPulseUs
  const fraction = span > 0 ? (pulseUs - servo.centerPulseUs) / span : 0
  return servo.maxAngleDeg * clamp(fraction, 0, 1)
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

function magicFormula(slip: number, load: number, tire: TireSpec): number {
  const mu = tire.mu * Math.max(0, 1 - tire.loadSensitivity * (load - 4.0))
  return mu * load * Math.sin(tire.shape * Math.atan(tire.stiffness * slip))
}

/**
 * A tire only builds lateral force once the contact patch is actually sliding.
 * Without this, a car standing still with the wheels turned would generate full
 * grip, because the slip angle is nonzero while the slip velocity is zero.
 */
const SLIP_VELOCITY_REFERENCE = 0.5

function gripAvailability(slipAngle: number, forwardSpeed: number): number {
  const slipVelocity = Math.abs(forwardSpeed) * Math.abs(Math.tan(slipAngle))
  return Math.min(1, slipVelocity / SLIP_VELOCITY_REFERENCE)
}

export class RcVehicle {
  readonly spec: VehicleSpec
  readonly state: VehicleState
  private servoAngle: number

  constructor(spec: VehicleSpec) {
    this.spec = spec
    this.servoAngle = 0
    this.state = {
      x: 0,
      y: 0,
      yaw: 0,
      vx: 0,
      vy: 0,
      yawRate: 0,
      motorOmega: 0,
      wheelOmega: 0,
      servoAngleDeg: 0,
      steerAngleRad: 0,
      throttle: 0,
      motorCurrent: 0,
      motorTorque: 0,
      driveForce: 0,
      longitudinalSlip: 0,
      lateralSlipFront: 0,
      lateralSlipRear: 0,
      distance: 0,
    }
  }

  get speed(): number {
    return Math.hypot(this.state.vx, this.state.vy)
  }

  step(dt: number, inputs: VehicleInputs): VehicleState {
    const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP))
    for (let index = 0; index < substeps; index += 1) {
      this.integrate(dt / substeps, inputs)
    }
    return this.state
  }

  private integrate(dt: number, inputs: VehicleInputs): void {
    const { chassis, motor, esc, servo, drivetrain, tire } = this.spec
    const state = this.state

    const command = escCommand(inputs.throttlePulseUs, esc)
    state.throttle = command.throttle

    const halfBase = chassis.wheelbase / 2
    const frontDistance = halfBase - chassis.comOffset
    const rearDistance = halfBase + chassis.comOffset
    const weight = chassis.mass * GRAVITY
    const frontLoad = (weight * rearDistance) / chassis.wheelbase
    const rearLoad = (weight * frontDistance) / chassis.wheelbase

    const steerTarget = servoTargetAngle(inputs.steerPulseUs, servo)
    const maxRate = (60 / servo.secondsPer60Deg) * dt
    const delta = clamp(steerTarget - this.servoAngle, -maxRate, maxRate)
    this.servoAngle += delta
    state.servoAngleDeg = this.servoAngle
    const steerRatio = servo.maxRoadWheelAngleDeg / Math.max(1e-6, servo.maxAngleDeg)
    // A positive servo angle is a right-hand command; the body frame used here
    // takes a positive road-wheel angle as a left turn, so the sign flips.
    const steerAngle = -(this.servoAngle * steerRatio * Math.PI) / 180
    state.steerAngleRad = steerAngle

    const surfaceSpeed = Math.max(Math.abs(state.vx), 0.6)
    const slip = (drivetrain.driveWheelRadius * state.wheelOmega - state.vx) / surfaceSpeed
    state.longitudinalSlip = slip
    const driveForce = magicFormula(clamp(slip, -4, 4), rearLoad, tire)

    // Kv is quoted in rpm per volt; the SI torque/back-EMF constant is 9.55/Kv,
    // and Kt equals Ke numerically in SI units.
    const ke = 9.55 / motor.kv
    const kt = ke
    const backEmf = ke * state.motorOmega
    let current = (command.voltage - backEmf) / motor.resistance
    const limit = command.throttle >= 0.99 ? esc.peakCurrent : esc.continuousCurrent
    current = clamp(current, -limit, limit)
    let torque = kt * current
    const friction = motor.frictionTorque * Math.sign(state.motorOmega || torque)
    if (Math.abs(state.motorOmega) < 1e-3 && Math.abs(torque) < motor.frictionTorque) {
      torque = 0
      state.motorOmega = 0
    } else {
      torque -= friction
    }

    const loadTorque = (driveForce * drivetrain.driveWheelRadius) / (drivetrain.gearRatio *
                                                                      drivetrain.efficiency)
    const wheelTorque = torque * drivetrain.gearRatio * drivetrain.efficiency
    if (Math.abs(loadTorque) > Math.abs(wheelTorque) && Math.abs(state.motorOmega) < 1e-3) {
      state.motorOmega = 0
    }
    // The motor may run backwards, but never past the speed where its own
    // back-EMF equals the supply voltage.
    const freeSpeed = command.voltage !== 0 ? Math.abs(command.voltage) / ke : 0
    const motorAcceleration = (torque - loadTorque) / motor.inertia
    state.motorOmega = clamp(state.motorOmega + motorAcceleration * dt, -freeSpeed, freeSpeed)
    state.wheelOmega = state.motorOmega / drivetrain.gearRatio
    state.motorCurrent = current
    state.motorTorque = torque
    state.driveForce = driveForce

    const slipFront = Math.atan2(state.vy + chassis.wheelbase * state.yawRate * frontDistance,
                                 Math.max(Math.abs(state.vx), 0.6)) - steerAngle
    const slipRear = Math.atan2(state.vy - chassis.wheelbase * state.yawRate * rearDistance,
                                Math.max(Math.abs(state.vx), 0.6))
    state.lateralSlipFront = slipFront
    state.lateralSlipRear = slipRear
    const lateralFront = magicFormula(clamp(slipFront, -0.6, 0.6), frontLoad, tire) *
                         gripAvailability(slipFront, state.vx)
    const lateralRear = magicFormula(clamp(slipRear, -0.6, 0.6), rearLoad, tire) *
                        gripAvailability(slipRear, state.vx)

    const drag = 0.5 * chassis.airDensity * chassis.dragCoefficient * chassis.frontalArea *
                 state.vx * Math.abs(state.vx)
    const rolling = tire.rollingResistance * weight * Math.sign(state.vx)
    const bodyForceX = driveForce + lateralFront * Math.sin(steerAngle) - drag - rolling
    const bodyForceY = lateralFront * Math.cos(steerAngle) + lateralRear

    const accelerationX = bodyForceX / chassis.mass + state.vy * state.yawRate
    const accelerationY = bodyForceY / chassis.mass - state.vx * state.yawRate
    state.vx += accelerationX * dt
    state.vy += accelerationY * dt

    const moment = frontDistance * lateralFront * Math.cos(steerAngle) - rearDistance * lateralRear
    state.yawRate += (moment / chassis.yawInertia) * dt
    const gripLimit = (tire.mu * weight) / Math.max(Math.abs(state.vx), 1.0)
    state.yawRate = clamp(state.yawRate, -gripLimit, gripLimit)

    const cosYaw = Math.cos(state.yaw)
    const sinYaw = Math.sin(state.yaw)
    state.x += (state.vx * cosYaw - state.vy * sinYaw) * dt
    state.y += (state.vx * sinYaw + state.vy * cosYaw) * dt
    state.yaw += state.yawRate * dt
    state.distance += Math.abs(state.vx) * dt
  }
}
