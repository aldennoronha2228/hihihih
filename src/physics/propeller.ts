/**
 * Propeller aerodynamics from blade-element momentum theory.
 *
 * This is what makes a motor "spin a fan" instead of "turn a flag on". Given
 * a propeller's geometry and a rotational speed it returns thrust, absorbed
 * shaft power and the reaction torque that pushes against the airframe. Every
 * quantity here is derived from the geometry and the local air density; no
 * thrust table or per-drone magic number is consulted.
 *
 * Reference for the formulation: Drela, "Rotor Aerodynamics for Designers"
 * (the QProp lecture notes), for the momentum-theory split between induced and
 * profile power, and standard blade-element practice for the static
 * coefficients.
 */

import type { AtmosphereSample } from './atmosphere'

export type PropellerSpec = {
  /** Rotor tip-to-tip diameter, metres. */
  diameter: number
  /** Number of blades. */
  blades: number
  /** Geometric blade length, metres, tip to root. */
  bladeLength: number
  /** Mean blade chord, metres, area-averaged across the span. */
  meanChord: number
  /**
   * Section lift coefficient at the operating angle of attack. A cambered
   * thin aerofoil at its best CL runs about 0.8-1.1; a flat plate at 10 degrees
   * reaches roughly 1.2. Used to derive the static thrust coefficient.
   */
  sectionLift?: number
  /**
   * Section profile drag coefficient. Aerofoils sit around 0.01-0.02 in
   * attached flow; small propellers near stall run higher.
   */
  sectionDrag?: number
  /** Measured/override advance ratio at which thrust reaches zero. */
  maxAdvanceRatio?: number
  /** Measured/override static thrust coefficient, dimensionless. */
  staticThrustCoefficient?: number
}

export type PropellerResult = {
  /** Thrust along the rotor axis, newtons. Positive is up the thrust axis. */
  thrust: number
  /** Shaft power absorbed by the propeller, watts. */
  shaftPower: number
  /** Reaction torque about the shaft axis, newton-metres. */
  torque: number
  /** Power coefficient of the propeller. */
  powerCoefficient: number
  /** Thrust coefficient of the propeller. */
  thrustCoefficient: number
  /** Advance ratio. */
  advanceRatio: number
  /** Tip speed, m/s. */
  tipSpeed: number
  /** Aerodynamic efficiency, thrust power divided by shaft power. */
  efficiency: number
  /** True if the rotor is advancing so fast that it produces no net thrust. */
  windmilling: boolean
}

/** Disc area of the rotor, m^2. */
export function discArea(propeller: PropellerSpec): number {
  return (Math.PI * propeller.diameter * propeller.diameter) / 4
}

/**
 * Rotor solidity: total blade planform area over disc area. This is the single
 * number that ties blade size to how much thrust the rotor can make.
 */
export function solidity(propeller: PropellerSpec): number {
  const area = discArea(propeller)
  if (!(area > 0)) return 0
  return (propeller.blades * propeller.bladeLength * propeller.meanChord) / area
}

/**
 * Static thrust coefficient.
 *
 * Blade-element theory gives CT = sigma * CL / 2 for a rotor in hover: the
 * circulation around the blades produces a force jump across the disc, and
 * the blade's contribution scales with how much of the disc it covers.
 *
 * Tip loss is deliberately not modelled here. The standard Prandtl
 * corrections for finite blade count need a second input (the blade's own
 * solidity distribution) that a planform alone does not supply, and
 * substituting a guessed factor for it moves the answer by tens of percent.
 * `sectionLift` is therefore the calibration knob, and it should be set from
 * the actual prop: a blade working near its best lift runs about 1.0-1.2, and
 * a small high-loading prop running nearer stall needs 1.4-1.6.
 */
function staticThrustCoefficient(propeller: PropellerSpec): number {
  if (propeller.staticThrustCoefficient !== undefined && propeller.staticThrustCoefficient > 0) {
    return propeller.staticThrustCoefficient
  }
  return (Math.max(0, solidity(propeller)) / 2) * (propeller.sectionLift ?? 1.0)
}

/**
 * Maximum advance ratio, the ratio of forward speed to tip speed beyond which
 * the blade sees negative angle of attack everywhere and produces no thrust.
 * Small propellers have steep helix angles, so they reach only about 0.4-0.8.
 */
function maxAdvanceRatio(propeller: PropellerSpec): number {
  if (propeller.maxAdvanceRatio !== undefined && propeller.maxAdvanceRatio > 0) {
    return propeller.maxAdvanceRatio
  }
  return 0.7
}

/**
 * Thrust coefficient at advance ratio J.
 *
 * CT is flat at low advance ratio, because the rotor is already at its best
 * lift coefficient, and collapses to zero as the rotor approaches its maximum
 * advance ratio. The squared form reproduces both the plateau and the steep
 * cut-off of measured small-propeller curves.
 */
export function thrustCoefficient(propeller: PropellerSpec, advanceRatio: number): number {
  const jMax = maxAdvanceRatio(propeller)
  const ratio = advanceRatio / jMax
  // The guard must be on the magnitude. A rotor descending through still air
  // sees a NEGATIVE advance ratio, and that is the normal case in flight; the
  // quadratic term grows without bound past the cutoff, so letting a negative
  // ratio through would hand a climbing rotor an enormous phantom thrust.
  if (!(Math.abs(ratio) < 1)) return 0
  const c0 = staticThrustCoefficient(propeller)
  return c0 * Math.pow(1 - ratio * ratio, 2)
}

/**
 * Induced velocity at the disc as a fraction of tip speed.
 *
 * Actuator-disc momentum theory gives, for a thrust coefficient CT,
 *
 *     CT = (pi/2) * lambda * (J + lambda)
 *
 * where lambda is the induced speed at the disc and J is the advance ratio.
 * Solving that quadratic for lambda is what makes the power model consistent:
 * the shaft power has to cover the whole kinetic energy the rotor imparts to
 * the flow, not just the part that becomes useful thrust.
 *
 * The root with the same sign as J is the physical one. The other root
 * describes a disc being driven backwards through the flow, which a free
 * propeller does not do.
 */
export function inducedVelocityRatio(thrustRatio: number, advanceRatio: number): number {
  if (!(thrustRatio > 0)) return 0
  const discriminant = advanceRatio * advanceRatio + (8 * thrustRatio) / Math.PI
  if (!(discriminant > 0)) return 0
  const sign = advanceRatio < 0 ? -1 : 1
  return (-advanceRatio + sign * Math.sqrt(discriminant)) / 2
}

/**
 * Profile (blade-section) power coefficient.
 *
 * Skin friction on the blades is paid whatever the prop is doing, so it shows
 * up as a power floor that does not vanish with thrust. This is the term that
 * makes a windmilling propeller absorb power while producing no thrust.
 */
function profilePowerCoefficient(propeller: PropellerSpec): number {
  const drag = propeller.sectionDrag ?? 0.015
  return Math.max(0, solidity(propeller)) * drag
}

/**
 * Magnitude of the advance ratio, clamped to a range a real rotor can see.
 *
 * This is not a fudge: a rotor that is barely turning has an advance ratio
 * that is mathematically unbounded, because both the definition and the
 * physics of a rotor at zero speed are singular. Clamping keeps a numerically
 * extreme frame from turning into a physically impossible force.
 */
function clampedAdvanceRatio(propeller: PropellerSpec, advanceRatio: number): number {
  const limit = maxAdvanceRatio(propeller) * 4
  return Math.max(-limit, Math.min(limit, advanceRatio))
}

/**
 * Evaluate a propeller at a rotational speed and an axial airspeed.
 *
 * `axialSpeed` is the component of airflow along the rotor axis, positive when
 * air flows through the disc in the direction the rotor drives it. A rotor
 * descending generates its own upwash and so sees a negative axial speed,
 * which raises its advance ratio and makes it produce more thrust for less
 * power, exactly as the real thing does.
 */
export function evaluatePropeller(
  propeller: PropellerSpec,
  revolutionsPerSecond: number,
  axialSpeed: number,
  air: AtmosphereSample,
): PropellerResult {
  const rho = air.density
  const n = Math.abs(revolutionsPerSecond)
  const diameter = Math.max(1e-6, propeller.diameter)
  const tipSpeed = n * diameter
  // Guard the degenerate zero-rpm case so advance ratio stays finite.
  const advanceRatio = n > 1e-6 ? clampedAdvanceRatio(propeller, axialSpeed / (n * diameter)) : 0
  const ct = thrustCoefficient(propeller, advanceRatio)
  const thrust = ct * rho * n * n * Math.pow(diameter, 4)

  // Power the rotor must supply: the kinetic energy it imparts to the whole
  // flow column through the disc, plus the blade profile drag. Taking only the
  // useful part would let efficiency exceed one, which no rotor can do.
  const lambda = inducedVelocityRatio(ct, advanceRatio)
  const inducedPower = thrust * tipSpeed * (advanceRatio + lambda)
  const profilePower =
    profilePowerCoefficient(propeller) * 0.5 * rho * discArea(propeller) * tipSpeed * tipSpeed * tipSpeed
  const shaftPower = Math.max(0, inducedPower + profilePower)
  const torque = n > 1e-6 ? shaftPower / (2 * Math.PI * n) : 0
  const thrustPower = thrust * axialSpeed
  const windmilling = advanceRatio >= maxAdvanceRatio(propeller) && n > 1e-6

  return {
    thrust,
    shaftPower,
    torque,
    powerCoefficient: shaftPower / (rho * n * n * n * Math.pow(diameter, 5)),
    thrustCoefficient: ct,
    advanceRatio,
    tipSpeed,
    efficiency: shaftPower > 1e-9 ? thrustPower / shaftPower : 0,
    windmilling,
  }
}