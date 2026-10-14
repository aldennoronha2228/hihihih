/**
 * ISA standard atmosphere (ICAO / ISO 2533) and derived flow properties.
 *
 * Propeller and airframe aerodynamics both need air density, and density is
 * not a constant: at 18km the air is a tenth as dense as at sea level, so a
 * model that hardcodes 1.225 kg/m3 is wrong everywhere except the runway.
 */

export const GRAVITY = 9.80665
/** Molar mass of dry air, kg/mol (ICAO). */
const M = 0.0289644
/** Universal gas constant, J/(mol K). */
const R_UNIVERSAL = 8.3144598
/** Sea-level pressure, Pa. */
const P0 = 101325
/** Sea-level temperature, K (15 degC is the standard, not 20). */
const T0 = 288.15
/** Specific gas constant for dry air, J/(kg K). */
const R_SPECIFIC = R_UNIVERSAL / M
/** Ratio of specific heats. */
const GAMMA = 1.4
/** Adiabatic lapse rate, K/m. */
const LAPSE = 0.0065
/**
 * Exponent of the barometric formula, g*M/(R*L). NOT the ratio of specific
 * heats: that number belongs to the adiabatic relations, and using it here is a
 * classic way to get an atmosphere that gets denser with altitude.
 */
const BAROMETRIC = (GRAVITY * M) / (LAPSE * R_UNIVERSAL)
/** Geopotential altitude at which the lapse layer ends, m. */
const TROPOPAUSE = 11000
const T_TROP = T0 - LAPSE * TROPOPAUSE

export type AtmosphereSample = {
  /** Temperature, K. */
  temperature: number
  /** Static pressure, Pa. */
  pressure: number
  /** Air density, kg/m^3. */
  density: number
  /** Speed of sound, m/s. */
  speedOfSound: number
}

/**
 * Troposphere: temperature falls linearly, pressure follows the
 * barometric formula. Below the tropopause that formula is exact.
 */
function layerBelow(geopotentialAltitude: number): { temperature: number; pressure: number } {
  return {
    temperature: T0 - LAPSE * geopotentialAltitude,
    pressure: P0 * Math.pow(1 - (LAPSE * geopotentialAltitude) / T0, BAROMETRIC),
  }
}

/**
 * Isothermal stratosphere above the tropopause: temperature constant,
 * pressure exponential with scale height H = RT/g.
 */
function layerAbove(geopotentialAltitude: number): { temperature: number; pressure: number } {
  const scaleHeight = (R_SPECIFIC * T_TROP) / GRAVITY
  return {
    temperature: T_TROP,
    pressure: P_TROPOPAUSE * Math.exp(-(geopotentialAltitude - TROPOPAUSE) / scaleHeight),
  }
}

const P_TROPOPAUSE = P0 * Math.pow(1 - (LAPSE * TROPOPAUSE) / T0, BAROMETRIC)

/**
 * Atmospheric state at a geometric altitude.
 *
 * Input is geometric altitude in metres; the ISA reference tables are
 * geopotential. Below 11km the two differ by less than 0.2%, which is far
 * under the error of any propeller model, so no geopotential conversion is
 * applied.
 */
export function atmosphere(altitudeMetres: number): AtmosphereSample {
  const altitude = Number.isFinite(altitudeMetres) ? Math.max(-500, altitudeMetres) : 0
  const { temperature, pressure } =
    altitude < TROPOPAUSE ? layerBelow(altitude) : layerAbove(altitude)
  const density = pressure / (R_SPECIFIC * temperature)
  return { temperature, pressure, density, speedOfSound: Math.sqrt(GAMMA * R_SPECIFIC * temperature) }
}

/** Dynamic pressure of a body moving at `speed` through air of `density`, Pa. */
export function dynamicPressure(density: number, speed: number): number {
  return 0.5 * density * speed * speed
}

/**
 * Kinematic viscosity of air, m^2/s, via Sutherland's law.
 * Reynolds-number corrections in the airframe drag model depend on it.
 */
export function kinematicViscosity(temperature: number): number {
  // Sutherland's empirical fit for dry air.
  const t = Math.max(150, temperature)
  return (1.458e-6 * Math.pow(t, 1.5)) / (t + 110.4)
}