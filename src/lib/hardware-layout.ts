import type { HardwareComponent, HardwarePin, HardwareProject, WireEndpoint } from './hardware'

export type ComponentSize = { width: number; height: number }
export type HardwareScenePoint = { x: number; z: number }

/** Resolve a pin from the same live component pin metadata used by the 2D canvas. */
export function hardwarePinPosition(
  project: Pick<HardwareProject, 'components'> | null,
  pins: Record<string, HardwarePin[]>,
  endpoint: WireEndpoint,
  preview?: ({ id: string } & Partial<Pick<HardwareComponent, 'x' | 'y' | 'rotation'>>) | null,
) {
  const canonical = project?.components.find(part => part.id === endpoint.component)
  if (!canonical) return null
  const part = preview?.id === canonical.id ? { ...canonical, ...preview } : canonical
  const info = pins[endpoint.component] ?? []
  const aliases = [
    endpoint.pin,
    endpoint.pin.replace(/^D(?=\d)/, ''),
    endpoint.pin === 'GND' ? 'GND.1' : endpoint.pin,
    endpoint.pin === 'TX' ? '1' : endpoint.pin === 'RX' ? '0' : endpoint.pin,
  ]
  const pin = aliases.map(name => info.find(candidate => candidate.name === name)).find(Boolean)
  if (!pin || pin.x === undefined || pin.y === undefined) return null
  const radians = part.rotation * Math.PI / 180
  return {
    x: part.x + pin.x * Math.cos(radians) - pin.y * Math.sin(radians),
    y: part.y + pin.x * Math.sin(radians) + pin.y * Math.cos(radians),
  }
}

/** Center a visual model on the measured HTML component footprint, honoring its 2D rotation. */
export function hardwareComponentCenter(part: HardwareComponent, size?: ComponentSize) {
  const width = size?.width ?? 0
  const height = size?.height ?? 0
  const radians = part.rotation * Math.PI / 180
  return {
    x: part.x + width / 2 * Math.cos(radians) - height / 2 * Math.sin(radians),
    y: part.y + width / 2 * Math.sin(radians) + height / 2 * Math.cos(radians),
  }
}

/** The 3D viewport maps the 2D canvas to 2 scene units; this is not a calibrated physical scale. */
export function hardwareCanvasToScene(point: { x: number; y: number }): HardwareScenePoint {
  return { x: (point.x - 500) / 500, z: (point.y - 325) / 500 }
}
