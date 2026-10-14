/**
 * Bridges real firmware output to the vehicle model.
 *
 * The simulator publishes the actual PWM duty cycle the firmware wrote to the
 * AVR's OCR registers (`pollPwmRegisters` in vendor/velxio/frontend/src/
 * simulation/AVRSimulator.ts calls `pinManager.updatePwm(pin, duty, timeMs)`).
 * Nothing here invents a throttle: the duty comes from those registers, and the
 * timestamp comes from the emulator's own clock, so the vehicle integrates on
 * simulated time rather than wall time.
 *
 * Pin map for the RC project (dc7ee0d488ab414aa4c79fd4113d3fd4):
 *   D6  -> L293D EN1, hardware PWM, throttle duty
 *   D11 -> L293D EN2, hardware PWM, second drive channel
 *   D7 / D8 -> L293D IN1 / IN2, drive direction
 *   D3  -> steering servo, Timer2 frame at 50 Hz
 */

import { RcVehicle, type VehicleSpec } from './vehicle'

export type PwmSample = {
  /** Duty cycle 0..1 as published by the emulator. */
  duty: number
  /** Emulator clock in milliseconds when the sample was taken. */
  timeMs: number
}

export type RcDriveBridgeOptions = {
  /** Nano D6: the L293D EN pin carrying throttle PWM. */
  throttlePin: number
  /** Nano D3: the steering servo pin. */
  steeringPin: number
  /** Servo frame period, microseconds. 50 Hz hobby servo. */
  servoPeriodUs?: number
  /** Smallest duty treated as meaningful, to reject idle noise. */
  deadband?: number
}

export type RcDriveState = {
  throttle: number
  direction: number
  steerPulseUs: number
  simulatedMs: number
  advanced: boolean
}

const DEFAULT_SERVO_PERIOD_US = 20000

/**
 * A duty cycle on a Timer0 output at 8-bit resolution is the throttle. This is
 * the same signal a real H-bridge would average into a motor terminal voltage.
 */
export function dutyToThrottle(duty: number, deadband = 0.01): number {
  if (!Number.isFinite(duty)) return 0
  return Math.min(1, Math.max(0, duty - deadband)) / (1 - deadband)
}

/**
 * Steering comes from the servo frame: a 50 Hz pulse whose width is 1000-2400 us
 * commands the angle. Recovering the width from the duty cycle needs the frame
 * period, which the servo specification fixes at 20 ms.
 */
export function dutyToServoPulse(duty: number, periodUs = DEFAULT_SERVO_PERIOD_US): number {
  if (!Number.isFinite(duty)) return periodUs / 20
  return Math.min(periodUs, Math.max(0, duty)) * periodUs
}

export class RcDriveBridge {
  readonly options: Required<RcDriveBridgeOptions>
  readonly vehicle: RcVehicle
  private lastSimulatedMs: number | null = null
  private lastThrottleSample: PwmSample | null = null
  private lastSteeringSample: PwmSample | null = null
  private direction = 1

  constructor(spec: VehicleSpec, options: RcDriveBridgeOptions, vehicle?: RcVehicle) {
    this.options = {
      servoPeriodUs: DEFAULT_SERVO_PERIOD_US,
      deadband: 0.01,
      ...options,
    }
    this.vehicle = vehicle ?? new RcVehicle(spec)
  }

  /** Drive direction, read from the H-bridge IN pins by the caller. */
  setDirection(direction: number): void {
    this.direction = direction === 0 ? 0 : direction > 0 ? 1 : -1
  }

  /**
   * Feed the newest PWM samples and the current emulator clock. The vehicle is
   * advanced by the elapsed *simulated* time only; if the clock has not moved,
   * nothing is integrated, so a stalled or paused emulator cannot invent motion.
   */
  update(samples: { throttle?: PwmSample, steering?: PwmSample }, simulatedMs: number): RcDriveState {
    if (samples.throttle) this.lastThrottleSample = samples.throttle
    if (samples.steering) this.lastSteeringSample = samples.steering

    const throttleDuty = this.lastThrottleSample?.duty ?? 0
    const throttle = dutyToThrottle(throttleDuty, this.options.deadband) * this.direction
    const steerPulseUs = dutyToServoPulse(this.lastSteeringSample?.duty ?? 0.09,
                                           this.options.servoPeriodUs)

    let advanced = false
    if (this.lastSimulatedMs !== null) {
      const elapsed = (simulatedMs - this.lastSimulatedMs) / 1000
      if (elapsed > 0) {
        this.vehicle.step(elapsed, {
          throttlePulseUs: 1500 + throttle * 500,
          steerPulseUs,
        })
        advanced = true
      }
    }
    this.lastSimulatedMs = simulatedMs

    return {
      throttle,
      direction: this.direction,
      steerPulseUs,
      simulatedMs,
      advanced,
    }
  }

  get throttlePin(): number {
    return this.options.throttlePin
  }

  get steeringPin(): number {
    return this.options.steeringPin
  }
}
