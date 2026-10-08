import { useEffect, useRef, useState } from 'react'
import { ComponentRegistry } from '../../vendor/velxio/frontend/src/services/ComponentRegistry'
import { readPinInfo } from '../../vendor/velxio/frontend/src/utils/readPinInfo'
import '../../vendor/velxio/frontend/src/elements-register'
import type { HardwareComponent, HardwarePin } from '../lib/hardware'
import type { HardwareRuntime } from './runtime'

export function HardwarePart({ part, runtime, pinsChanged }: {
  part: HardwareComponent; runtime: HardwareRuntime | null; pinsChanged: (id: string, pins: HardwarePin[]) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLElement | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const properties = useRef(part.properties)
  useEffect(() => { properties.current = part.properties }, [part.properties])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setInterval> | undefined
    let current: HTMLElement | null = null
    const registry = ComponentRegistry.getInstance()
    void registry.load().then(() => {
      if (!active || !host.current) return
      const alias = part.type === 'pi-pico' ? 'raspberry-pi-pico' : part.type === 'pi-pico-w' ? 'raspberry-pi-pico-w' : part.type
      const metadata = registry.getById(part.type) || registry.getById(alias)
      if (!metadata || !customElements.get(metadata.tagName)) { setUnavailable(true); return }
      current = document.createElement(metadata.tagName)
      element.current = current
      Object.assign(current, metadata.defaultValues, properties.current)
      host.current.replaceChildren(current)
      runtime?.registerElement(part.id, current)
      const read = () => {
        if (!active) return
        const info = readPinInfo<HardwarePin>(current)
        if (info?.length) pinsChanged(part.id, info)
      }
      current.addEventListener('pininfo-change', read)
      timer = setInterval(read, 400)
      read()
    }).catch(() => { if (active) setUnavailable(true) })
    return () => {
      active = false
      if (timer) clearInterval(timer)
      runtime?.registerElement(part.id, null)
      current?.remove()
      element.current = null
    }
  }, [part.id, part.type, runtime, pinsChanged])
  useEffect(() => {
    if (element.current) {
      Object.assign(element.current, part.properties)
      runtime?.updateComponentProperties(part.id, part.properties)
    }
  }, [part.id, part.properties, runtime])
  return <div className="hw-part-element" ref={host}>{unavailable && <div className="hw-unavailable">{part.type}<small>Element unavailable · placement only</small></div>}</div>
}
