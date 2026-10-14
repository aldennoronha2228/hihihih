/**
 * Multirotor rigid body driven by real motor and propeller models.
 *
 * The rigid body itself is integrated by Rapier, which handles the attitude
 * quaternion, the inertia tensor, ground contact and collision response. What
 * Rapier does not do, and what lives here, is the aerodynamics: each rotor's
 * thrust comes out of propeller.ts at whatever speed the motor model has
 * actually reached, is applied at that rotor's real hub position, and
 * contributes its reaction torque about the vertical axis.
 *
 * Nothing in this file decides how fast a propeller turns. Throttle comes from
 * outside, normally the duty cycle the firmware wrote to a PWM register.
 */

import { atmosphere, dynamicPressure, type AtmosphereSample } from './atmosphere'
import { evaluatePropeller, type PropellerSpec } from './propeller'
import { createMotorState, escDriveVoltage, stepMotor, type EscSpec, type MotorState, type MotorSpec } from './motor'
import { GRAVITY } from './atmosphere'

/** A vector in the airframe's body frame, metres. */
export type BodyVector = { x: number; y: number; z: number }

export type RotorSpec = {
  /** Name for diagnostics. */
  name: string
  /** Hub position in the body frame, metres, relative to the centre of mass. */
  position: BodyVector
  /**
   * Spin direction about the rotor axis: +1 turns one way, -1 the other.
   * Counter-rotating pairs are what let a multirotor yaw without a tail.
   */
  direction: 1 | -1
  /**
   * Index of the control channel that drives this rotor. The firmware's PWM
   * duty cycle for that channel is the rotor's throttle command.
   */
  channel: number
  /** Propeller for this rotor, if it differs from the airframe default. */
  propeller?: PropellerSpec
  /** Motor for this rotor, if it differs from the airframe default. */
  motor?: MotorSpec
}

export type AirframeSpec = {
  name: string
  /** Total mass in kilograms: airframe, battery, electronics, payload. */
  mass: number
  /** Centre of mass in the body frame, metres. */
  centerOfMass: BodyVector
  /**
   * Optional override for the principal moments of inertia, kg*m^2, in the
   * body frame.
   *
   * Left unset by default, in which case the inertia tensor is derived from
   * the collision shape built from the rotor layout. That is the better
   * default: a flat quad really is far harder to roll and pitch than to spin
   * about vertical, and a central plate with four arms produces that
   * anisotropy on its own. Supply this only when you have a measured tensor.
   */
  principalInertia?: BodyVector
  rotors: RotorSpec[]
  propeller: PropellerSpec
  motor: MotorSpec
  esc: EscSpec
  /**
   * Body drag. Each entry is a reference area in m^2 with its drag
   * coefficient; the axis is chosen by which way the airframe is facing.
   */
  drag?: { frontalArea: number; frontalCoefficient: number; planArea: number; planCoefficient: number }
  /** Reference area and coefficient for the arms and motor pods, m^2. */
  armDrag?: { area: number; coefficient: number }
}

export type RotorTelemetry = {
  name: string
  channel: number
  /** Throttle actually commanded, 0..1. */
  throttle: number
  /** Drive voltage the ESC is applying, volts. */
  driveVoltage: number
  /** Commanded speed from the current throttle and the free speed, rev/s. */
  speed: number
  /** Actual rotor speed, rev/s. */
  revolutionsPerSecond: number
  /** Current drawn from the pack, amps. */
  current: number
  /** Thrust produced at the hub, newtons. */
  thrust: number
  /** Reaction torque about the rotor axis, N*m. */
  reactionTorque: number
  /** Advance ratio at the hub, including the airframe's own motion. */
  advanceRatio: number
}

export type AirframeState = {
  /** World position of the centre of mass, metres. */
  position: BodyVector
  /** World orientation quaternion, x, y, z, w. */
  orientation: { x: number; y: number; z: number; w: number }
  /** World linear velocity of the centre of mass, m/s. */
  linearVelocity: BodyVector
  /** World angular velocity, rad/s. */
  angularVelocity: BodyVector
  /** Per-rotor detail. */
  rotors: RotorTelemetry[]
  /** Total electrical power being drawn, watts. */
  power: number
  /** Total thrust, newtons. */
  totalThrust: number
  /** Principal moments of inertia actually in use, kg*m^2. */
  inertia: BodyVector
  /** Ground clearance of the lowest rotor, metres. */
  altitude: number
  /** True when the body is resting on something. */
  grounded: boolean
}

export type WorldOptions = {
  /** Ground height in metres. */
  groundHeight?: number
  /** Ground friction coefficient. */
  friction?: number
  /** Air velocity in the world frame, m/s. */
  wind?: BodyVector
  /** Ambient temperature, K. Defaults to the ISA value at the altitude. */
  temperature?: number
  /** Restitution of the ground. */
  restitution?: number
}

type RapierModule = typeof import('@dimforge/rapier3d-compat')

let rapierPromise: Promise<RapierModule> | null = null

/** Load the Rapier WebAssembly module once and share it. */
export function loadPhysics(): Promise<RapierModule> {
  if (!rapierPromise) {
    rapierPromise = import('@dimforge/rapier3d-compat').then(async module => {
      await module.init()
      return module
    })
  }
  return rapierPromise
}

const sub = (a: BodyVector, b: BodyVector): BodyVector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: BodyVector, b: BodyVector): BodyVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: BodyVector, k: number): BodyVector => ({ x: a.x * k, y: a.y * k, z: a.z * k })

/**
 * Rotate a body-frame vector into the world frame by a unit quaternion.
 * Rapier reports orientation as x, y, z, w.
 */
export function rotateVector(v: BodyVector, q: { x: number; y: number; z: number; w: number }): BodyVector {
  const { x, y, z, w } = q
  const ix = w * v.x + y * v.z - z * v.y
  const iy = w * v.y + z * v.x - x * v.z
  const iz = w * v.z + x * v.y - y * v.x
  const iw = -x * v.x - y * v.y - z * v.z
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  }
}

/** Rotate a world-frame vector back into the body frame. */
export function rotateVectorInverse(v: BodyVector, q: { x: number; y: number; z: number; w: number }): BodyVector {
  return rotateVector(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w })
}

type MotorRuntime = {
  spec: RotorSpec
  state: MotorState
}

/**
 * A multirotor whose rotors are driven by throttle commands that normally come
 * from firmware PWM, integrated by Rapier with real aerodynamics applied.
 */
export class MultirotorSimulator {
  readonly spec: AirframeSpec
  readonly rotors: MotorRuntime[]
  private readonly world: import('@dimforge/rapier3d-compat').World
  private readonly body: import('@dimforge/rapier3d-compat').RigidBody
  private readonly throttle = new Map<number, number>()
  private readonly wind: BodyVector
  private readonly groundHeight: number
  private readonly armArea: number
  private readonly armCoefficient: number
  private lastThrust = 0
  private lastPower = 0

  private constructor(RAPIER: RapierModule, spec: AirframeSpec, options: WorldOptions, start: BodyVector) {
    this.spec = spec
    this.groundHeight = options.groundHeight ?? 0
    this.wind = options.wind ?? { x: 0, y: 0, z: 0 }
    this.armArea = spec.armDrag?.area ?? 0
    this.armCoefficient = spec.armDrag?.coefficient ?? 0

    this.world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY })
    this.world.timestep = 1 / 240

    const longestArm = spec.rotors.reduce((max, rotor) => Math.max(max, Math.hypot(rotor.position.x, rotor.position.y)), 0)
    const span = Math.max(0.04, longestArm)
    // Frame proportions for a quadcopter: a thin central plate for the stack,
    // with slender arms running out to the motor pods.
    const plateHalf = Math.max(0.03, span * 0.42)
    const plateHalfThickness = Math.max(0.006, span * 0.06)
    const armHalfWidth = Math.max(0.004, span * 0.09)
    const armHalfThickness = Math.max(0.004, span * 0.07)

    const descriptor = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setLinearDamping(0.04)
      .setAngularDamping(0.04)
    this.body = this.world.createRigidBody(descriptor)

    // Collision shape built from the airframe's real layout: a plate for the
    // stack plus one arm per rotor. This is what sets the mass and the inertia
    // tensor, because Rapier derives both from collider geometry and density.
    //
    // Rapier's setAdditionalMassProperties is a no-op in this build, so mass
    // has to be carried by density. Taking the inertia from the shape is the
    // better outcome anyway: a flat quad is genuinely far harder to roll and
    // pitch than to spin about vertical, and a plate with four arms produces
    // exactly that anisotropy without anyone typing an inertia tensor in.
    const friction = options.friction ?? 0.9
    const restitution = options.restitution ?? 0.05
    const parts: { desc: import('@dimforge/rapier3d-compat').ColliderDesc; volume: number }[] = []

    parts.push({
      desc: RAPIER.ColliderDesc.cuboid(plateHalf, plateHalf, plateHalfThickness),
      volume: 8 * plateHalf * plateHalf * plateHalfThickness,
    })

    for (const rotor of spec.rotors) {
      const { x, y } = rotor.position
      const length = Math.hypot(x, y)
      if (length < 1e-6) continue
      const desc = RAPIER.ColliderDesc.cuboid(length, armHalfWidth, armHalfThickness)
      // The arm box is built along its local x axis, so point it at the hub.
      const angle = -Math.atan2(y, x)
      desc.setTranslation(x / 2, y / 2, 0)
      desc.setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) })
      parts.push({ desc, volume: 8 * length * armHalfWidth * armHalfThickness })
    }

    // Scale the whole shape so it carries the airframe's real mass.
    const total = parts.reduce((sum, part) => sum + part.volume, 0)
    const density = Math.max(1e-6, spec.mass / Math.max(1e-9, total))
    for (const part of parts) {
      this.world.createCollider(part.desc.setDensity(density).setFriction(friction).setRestitution(restitution), this.body)
    }
    this.body.recomputeMassPropertiesFromColliders()

    // Ground: a static half-space surrogate at the surface, thick enough that a
    // fast airframe cannot tunnel through it in one step.
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, this.groundHeight - 0.5))
    const groundShape = RAPIER.ColliderDesc.cuboid(200, 200, 0.5)
      .setFriction(options.friction ?? 0.9)
      .setRestitution(options.restitution ?? 0.05)
    this.world.createCollider(groundShape, groundBody)

    this.rotors = spec.rotors.map(rotor => ({
      spec: rotor,
      state: createMotorState(),
    }))
  }

  /**
   * Build the world and its body. Rapier's WebAssembly module loads
   * asynchronously, so this cannot be a plain constructor.
   */
  static async create(spec: AirframeSpec, options: WorldOptions = {}, start?: BodyVector): Promise<MultirotorSimulator> {
    const RAPIER = await loadPhysics()
    const armLength = spec.rotors.reduce((max, rotor) => Math.max(max, Math.hypot(rotor.position.x, rotor.position.y)), 0)
    // Drop the airframe in from roughly one rotor length up so a run can start
    // with the rotors already turning rather than with a free fall.
    const ground = options.groundHeight ?? 0
    const spawn: BodyVector = start ?? { x: 0, y: 0, z: ground + armLength * 2 }
    return new MultirotorSimulator(RAPIER, spec, options, spawn)
  }

  /**
   * Set a rotor's throttle, as a 0..1 duty cycle. This is normally called with
   * the duty cycle the firmware wrote to a PWM register.
   */
  setThrottle(channel: number, duty: number): void {
    if (!Number.isFinite(duty)) return
    this.throttle.set(channel, Math.min(1, Math.max(0, duty)))
  }

  /** Throttle currently commanded on a channel. */
  throttleOn(channel: number): number {
    return this.throttle.get(channel) ?? 0
  }

  /**
   * Advance the simulation by `dt` seconds of simulated time.
   *
   * The rotors are integrated inside the same step as the body, using the
   * airframe's own velocity through each disc so that a descending quad
   * generates upwash and gets more thrust from the same throttle.
   */
  step(dt: number): void {
    if (!(dt > 0)) return
    // Rapier integrates at a fixed rate; a longer frame is advanced in whole
    // sub-steps so the contact solver stays stable.
    const fixed = this.world.timestep
    let remaining = Math.min(dt, 0.25)
    while (remaining > 1e-9) {
      const slice = Math.min(fixed, remaining)
      this.substep(slice)
      remaining -= slice
    }
  }

  private substep(dt: number): void {
    const orientation = this.body.rotation()
    const linear = this.body.linvel()
    const quaternion = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
    const velocity: BodyVector = { x: linear.x, y: linear.y, z: linear.z }

    // Thrust acts along the body's own up axis, which is what a real rotor does.
    const thrustAxis = rotateVector({ x: 0, y: 0, z: 1 }, quaternion)
    const air = atmosphere(this.body.translation().z - this.groundHeight)

    this.body.resetForces(true)
    this.body.resetTorques(true)

    let totalThrust = 0
    let power = 0

    for (const rotor of this.rotors) {
      const propeller = rotor.spec.propeller ?? this.spec.propeller
      const motor = rotor.spec.motor ?? this.spec.motor
      const signal = this.throttleOn(rotor.spec.channel)

      // Airflow the disc actually sees: the airframe's own motion through the
      // air, less the wind. Rising through still air makes the prop work harder.
      const hubWorld = rotateVector(rotor.spec.position, quaternion)
      const hubPoint = add(this.body.translation(), hubWorld)
      const hubVelocity = add(velocity, this.velocityAtPoint(hubPoint))
      const relativeAir = sub(hubVelocity, this.wind)
      const axialSpeed = -(relativeAir.x * thrustAxis.x + relativeAir.y * thrustAxis.y + relativeAir.z * thrustAxis.z)

      const load = evaluatePropeller(propeller, rotor.state.revolutionsPerSecond, axialSpeed, air)
      const next = stepMotor(motor, this.spec.esc, propeller, rotor.state, signal, air, load.torque, dt)
      const produced = evaluatePropeller(propeller, next.revolutionsPerSecond, axialSpeed, air)
      rotor.state = next

      const thrust = produced.thrust
      totalThrust += thrust
      power += produced.shaftPower

      // Apply the thrust at the hub, so the body's centre of mass and its
      // rotation are both affected the way a real offset rotor affects them.
      this.body.addForceAtPoint(
        { x: thrustAxis.x * thrust, y: thrustAxis.y * thrust, z: thrustAxis.z * thrust },
        hubPoint,
        true,
      )

      // Reaction torque: the prop pushes the air one way, so the air pushes back
      // and tries to spin the airframe the same way the prop turns.
      const reaction = produced.torque * rotor.spec.direction
      this.body.addTorque({ x: thrustAxis.x * reaction, y: thrustAxis.y * reaction, z: thrustAxis.z * reaction }, true)
    }

    this.applyAirframeDrag(velocity, quaternion, air)
    this.world.step()
    this.lastThrust = totalThrust
    this.lastPower = power
  }

  /** Velocity of the material point at a world position, rigid-body motion. */
  private velocityAtPoint(point: BodyVector): BodyVector {
    const angular = this.body.angvel()
    const origin = this.body.translation()
    const r = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }
    const spin = { x: 0, y: 0, z: 0 }
    // omega x r
    spin.x = angular.y * r.z - angular.z * r.y
    spin.y = angular.z * r.x - angular.x * r.z
    spin.z = angular.x * r.y - angular.y * r.x
    return spin
  }

  /**
   * Aerodynamic resistance of the airframe itself. Without this a multirotor
   * slides sideways with no resistance at all, which makes any position
   * controller look far too effective.
   */
  private applyAirframeDrag(velocity: BodyVector, quaternion: { x: number; y: number; z: number; w: number }, air: AtmosphereSample): void {
    const bodyVelocity = rotateVectorInverse(velocity, quaternion)
    const drag = this.spec.drag
    const force: BodyVector = { x: 0, y: 0, z: 0 }

    if (drag) {
      // Choose the reference area by which way the airframe is travelling in
      // its own frame, which is what changes the drag when it pitches.
      const axes: [BodyVector, number, number][] = [
        [{ x: 0, y: 0, z: 1 }, drag.planArea, drag.planCoefficient],
        [{ x: 1, y: 0, z: 0 }, drag.frontalArea, drag.frontalCoefficient],
        [{ x: 0, y: 1, z: 0 }, drag.frontalArea, drag.frontalCoefficient],
      ]
      for (const [axis, area, coefficient] of axes) {
        const speed = bodyVelocity.x * axis.x + bodyVelocity.y * axis.y + bodyVelocity.z * axis.z
        if (!area || !coefficient) continue
        const magnitude = coefficient * dynamicPressure(air.density, speed) * area
        const along = speed === 0 ? 0 : -Math.sign(speed)
        force.x += axis.x * magnitude * along
        force.y += axis.y * magnitude * along
        force.z += axis.z * magnitude * along
      }
    }

    if (this.armArea > 0 && this.armCoefficient > 0) {
      const speed = Math.hypot(bodyVelocity.x, bodyVelocity.y, bodyVelocity.z)
      if (speed > 1e-6) {
        const magnitude = this.armCoefficient * dynamicPressure(air.density, speed) * this.armArea
        force.x -= (magnitude * bodyVelocity.x) / speed
        force.y -= (magnitude * bodyVelocity.y) / speed
        force.z -= (magnitude * bodyVelocity.z) / speed
      }
    }

    const world = rotateVector(force, quaternion)
    this.body.addForce({ x: world.x, y: world.y, z: world.z }, true)
  }

  /** Everything the UI needs to draw and explain the airframe's state. */
  telemetry(): AirframeState {
    const translation = this.body.translation()
    const rotation = this.body.rotation()
    const linear = this.body.linvel()
    const angular = this.body.angvel()
    const quaternion = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }

    const rotors: RotorTelemetry[] = this.rotors.map(rotor => {
      const propeller = rotor.spec.propeller ?? this.spec.propeller
      const air = atmosphere(translation.z - this.groundHeight)
      const produced = evaluatePropeller(propeller, rotor.state.revolutionsPerSecond, 0, air)
      return {
        name: rotor.spec.name,
        channel: rotor.spec.channel,
        throttle: rotor.state.throttle,
        driveVoltage: rotor.state.driveVoltage,
        speed: rotor.state.speed,
        revolutionsPerSecond: rotor.state.revolutionsPerSecond,
        current: rotor.state.current,
        thrust: produced.thrust,
        reactionTorque: produced.torque,
        advanceRatio: produced.advanceRatio,
      }
    })

    const principal = this.body.principalInertia()
    return {
      position: { x: translation.x, y: translation.y, z: translation.z },
      orientation: quaternion,
      linearVelocity: { x: linear.x, y: linear.y, z: linear.z },
      angularVelocity: { x: angular.x, y: angular.y, z: angular.z },
      rotors,
      power: this.lastPower,
      totalThrust: this.lastThrust,
      inertia: { x: principal.x, y: principal.y, z: principal.z },
      altitude: translation.z - this.groundHeight,
      grounded: Math.abs(translation.z - this.groundHeight) < 0.08,
    }
  }

  /** Stop the body where it is and clear its motion. */
  reset(position: BodyVector): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    for (const rotor of this.rotors) rotor.state = createMotorState()
  }

  /** Drive voltage a throttle would produce, for readback in the UI. */
  escVoltage(channel: number): number {
    return escDriveVoltage(this.throttleOn(channel), this.spec.esc, this.spec.motor)
  }
}

/** Convenience: a body-frame point, for building rotor layouts. */
export function corner(x: number, y: number, z = 0): BodyVector {
  return { x, y, z }
}

export { add, scale, sub }