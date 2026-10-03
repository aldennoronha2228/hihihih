import { useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CatalogComponent, HardwareComponent, HardwareProject, WireEndpoint } from '../lib/hardware'
import { analogPins, sourceCatalog } from '../hardware/spice'
import type { AnalogSolveResult } from '../hardware/spice'
import './schematic-canvas.css'

export type SchematicCanvasProps = {
  project: HardwareProject; selectedId?: string | null; result?: AnalogSolveResult | null; catalog?: CatalogComponent[]
  onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void
  onConnect?: (from: WireEndpoint, to: WireEndpoint) => void
}
type Point = { x: number; y: number }
type Drag = { id: string; origin: Point; start: Point; current: Point; moved: boolean }

function pinNames(component: HardwareComponent, catalog: CatalogComponent[]): string[] {
  const analog = analogPins(component)
  if (analog.length) return analog
  const entry = catalog.find(item => (item.type ?? item.id) === component.type)
  return entry?.connectable === false ? [] : (entry?.pins ?? []).map(pin => typeof pin === 'string' ? pin : pin.name)
}

function pinOffset(index: number, count: number): Point {
  if (count === 1) return { x: 0, y: -54 }
  if (count === 2) return { x: index === 0 ? -70 : 70, y: 0 }
  const rows = Math.ceil(count / 2), row = Math.floor(index / 2)
  return { x: index % 2 === 0 ? -70 : 70, y: (row - (rows - 1) / 2) * 22 }
}

function rotated(point: Point, rotation: number): Point {
  const angle = rotation * Math.PI / 180
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) }
}

function Symbol({ type }: { type: string }) {
  type = ({ 'source-dc-voltage': 'voltage-source', 'source-dc-current': 'current-source', 'source-sine-voltage': 'sine-source', 'source-pulse-voltage': 'pulse-source', 'source-pwl-voltage': 'pwl-source', 'source-ac-voltage': 'ac-source' } as Record<string, string>)[type] || type
  if (type === 'ground') return <g className="schematic-symbol"><path d="M0 -54V-12M-22 -12H22M-15 -3H15M-7 6H7" /></g>
  if (/resistor/.test(type)) return <g className="schematic-symbol"><path d="M-70 0H-36L-30 -12L-18 12L-6 -12L6 12L18 -12L30 12L36 0H70" /></g>
  if (/capacitor/.test(type)) return <g className="schematic-symbol"><path d="M-70 0H-8M-8 -23V23M8 -23V23M8 0H70" /></g>
  if (/inductor/.test(type)) return <g className="schematic-symbol"><path d="M-70 0H-32C-32 -25 -16 -25 -16 0C-16 -25 0 -25 0 0C0 -25 16 -25 16 0C16 -25 32 -25 32 0H70" /></g>
  if (/source$/.test(type)) return <g className="schematic-symbol"><path d="M-70 0H-28M28 0H70" /><circle r="28" />
    {type === 'current-source' ? <path d="M-14 0H14M6 -7L14 0L6 7" /> : type === 'pulse-source' ? <path d="M-18 9H-10V-9H8V9H18" /> : type === 'pwl-source' ? <path d="M-18 10L-7 -9L3 5L18 -8" /> : type === 'sine-source' || type === 'ac-source' ? <path d="M-19 0C-13 -20 -5 -20 0 0S13 20 19 0" /> : <><path d="M-13 -5V5M-18 0H-8M8 0H18" /></>}
  </g>
  return <g className="schematic-symbol schematic-unsupported"><rect x="-42" y="-28" width="84" height="56" rx="7" /><text textAnchor="middle" y="5">PART</text></g>
}

function valueLabel(component: HardwareComponent): string {
  const defaults = sourceCatalog.find(entry => entry.type === component.type)?.defaultValues ?? {}
  const p = { ...defaults, ...component.properties }
  if (/resistor/.test(component.type)) return `${String(p.value ?? '1k')} Ω`
  if (/capacitor/.test(component.type)) return `${String(p.value ?? '1u')} F`
  if (/inductor/.test(component.type)) return `${String(p.value ?? '1m')} H`
  if (['voltage-source', 'ac-source', 'source-dc-voltage', 'source-ac-voltage'].includes(component.type)) return `${String(p.voltage)} V DC`
  if (['current-source', 'source-dc-current'].includes(component.type)) return `${String(p.current)} A`
  if (['sine-source', 'source-sine-voltage'].includes(component.type)) return `${String(p.amplitude)} V · ${String(p.frequency)} Hz`
  if (['pulse-source', 'source-pulse-voltage'].includes(component.type)) return `${String(p.low)} → ${String(p.high)} V · T ${String(p.period)} s`
  if (['pwl-source', 'source-pwl-voltage'].includes(component.type)) return `${Array.isArray(p.points) ? p.points.length : '?'} PWL points`
  return component.type === 'ground' ? '0 V reference' : 'No analog model'
}

export function SchematicCanvas({ project, selectedId, result, catalog = [], onSelect, onMove, onConnect }: SchematicCanvasProps) {
  const gridId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<WireEndpoint | null>(null)
  const stale = !!result && result.projectRevision !== project.revision
  const positions = new Map(project.components.map(component => [component.id, drag?.id === component.id ? drag.current : { x: component.x, y: component.y }]))
  const pinMap = new Map(project.components.map(component => [component.id, pinNames(component, catalog)]))
  const padding = 110
  const xs = project.components.map(component => component.x), ys = project.components.map(component => component.y)
  const minX = Math.min(...(xs.length ? xs : [0])) - padding, minY = Math.min(...(ys.length ? ys : [0])) - padding
  const width = Math.max(640, Math.max(...(xs.length ? xs : [0])) - minX + padding), height = Math.max(380, Math.max(...(ys.length ? ys : [0])) - minY + padding)
  const endpointPoint = (endpoint: WireEndpoint): Point | null => {
    const component = project.components.find(part => part.id === endpoint.component)
    const pins = pinMap.get(endpoint.component), position = positions.get(endpoint.component)
    const index = pins?.indexOf(endpoint.pin) ?? -1
    if (!component || !pins || !position || index < 0) return null
    const offset = rotated(pinOffset(index, pins.length), component.rotation)
    return { x: position.x + offset.x, y: position.y + offset.y }
  }
  const localPoint = (event: ReactPointerEvent): Point => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return { x: event.clientX, y: event.clientY }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }
  const startDrag = (event: ReactPointerEvent<SVGGElement>, component: HardwareComponent) => {
    if (event.button !== 0 || !onMove) return
    const next = { id: component.id, origin: { x: component.x, y: component.y }, start: localPoint(event), current: { x: component.x, y: component.y }, moved: false }
    dragRef.current = next; setDrag(next)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const active = dragRef.current
    if (!active) return
    const point = localPoint(event), dx = point.x - active.start.x, dy = point.y - active.start.y
    const next = { ...active, current: { x: active.origin.x + dx, y: active.origin.y + dy }, moved: active.moved || Math.hypot(dx, dy) > 3 }
    dragRef.current = next; setDrag(next)
  }
  const finishDrag = () => {
    const active = dragRef.current
    if (active?.moved) onMove?.(active.id, active.current.x, active.current.y)
    dragRef.current = null; setDrag(null)
  }
  const clickPin = (endpoint: WireEndpoint) => {
    onSelect?.(endpoint.component)
    if (!onConnect) return
    if (pending && project.components.some(component => component.id === pending.component)) {
      if (pending.component !== endpoint.component || pending.pin !== endpoint.pin) onConnect(pending, endpoint)
      setPending(null)
    } else setPending(endpoint)
  }
  const invalidWires = project.wires.filter(wire => !endpointPoint(wire.from) || !endpointPoint(wire.to))
  return <section className="schematic-canvas" aria-label="Analog schematic">
    <header className="schematic-toolbar"><div><strong>Analog schematic</strong><span>2D circuit · {project.components.length} components · {project.wires.length} wires</span></div>
      <span className={`schematic-status${result?.ok && !stale ? ' is-solved' : ''}`}>{stale ? 'Results stale' : result ? result.ok ? 'ngspice solved' : 'Solve failed' : 'Not solved'}</span>
    </header>
    <div className="schematic-help">{pending ? `Connect ${pending.component}:${pending.pin} to another pin. Escape cancels.` : onConnect ? 'Click a component to select · click two pins to connect' : 'Click a component to select · edit with canonical project controls'}{onMove ? ' · drag to move' : ''}</div>
    <div className="schematic-viewport">
      <svg ref={svgRef} viewBox={`${minX} ${minY} ${width} ${height}`} role="img" aria-label="Flat circuit schematic with component pins and wires" onKeyDown={event => { if (event.key === 'Escape') setPending(null) }}>
        <defs><pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#283440" /></pattern></defs>
        <rect x={minX} y={minY} width={width} height={height} fill={`url(#${gridId})`} />
        <g className="schematic-wires">{project.wires.map(wire => {
          const a = endpointPoint(wire.from), b = endpointPoint(wire.to)
          if (!a || !b) return null
          const mid = (a.x + b.x) / 2, path = `M${a.x} ${a.y}H${mid}V${b.y}H${b.x}`
          const net = result?.pinNetMap[`${wire.from.component}:${wire.from.pin}`]
          const values = result?.ok && !stale && net ? result.nodeVoltages[net] : undefined
          const voltage = values?.at(-1)
          return <g key={wire.id}><path className="schematic-wire-halo" d={path} /><path className="schematic-wire" d={path} style={{ stroke: wire.color || '#70d7aa' }} /><title>{wire.id}: {wire.from.component}:{wire.from.pin} → {wire.to.component}:{wire.to.pin}{voltage !== undefined ? ` · ${voltage.toPrecision(4)} V` : ''}</title>
            {voltage !== undefined && <text className="schematic-voltage" x={mid + 6} y={a.y === b.y ? a.y - 10 : Math.max(a.y, b.y) + 19}>{net} · {voltage.toPrecision(4)} V</text>}
          </g>
        })}</g>
        {project.components.map(component => {
          const position = positions.get(component.id)!, pins = pinMap.get(component.id)!
          const name = sourceCatalog.find(entry => entry.type === component.type)?.name ?? catalog.find(entry => (entry.type ?? entry.id) === component.type)?.name ?? component.type
          return <g key={component.id} className={`schematic-part${selectedId === component.id ? ' is-selected' : ''}${onMove ? ' is-movable' : ''}`} transform={`translate(${position.x} ${position.y})`}>
            <g role="button" tabIndex={0} aria-label={`Select ${component.id}, ${name}`} onClick={() => onSelect?.(component.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(component.id) } }} onPointerDown={event => startDrag(event, component)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
              <rect className="schematic-part-hit" x="-82" y="-67" width="164" height="134" rx="12" />
              <g transform={`rotate(${component.rotation})`}><Symbol type={component.type} /></g>
              <text className="schematic-part-id" textAnchor="middle" y="-43">{component.id}</text>
              <text className="schematic-part-name" textAnchor="middle" y="43">{name}</text>
              <text className="schematic-part-value" textAnchor="middle" y="61">{valueLabel(component)}</text>
            </g>
            {pins.map((pin, index) => {
              const point = rotated(pinOffset(index, pins.length), component.rotation)
              const endpoint = { component: component.id, pin }
              const isPending = pending?.component === component.id && pending.pin === pin
              return <g key={pin} className={`schematic-pin${isPending ? ' is-pending' : ''}`} role="button" tabIndex={0} aria-label={`${component.id} pin ${pin}${onConnect ? ', connect' : ''}`} transform={`translate(${point.x} ${point.y})`} onClick={event => { event.stopPropagation(); clickPin(endpoint) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); clickPin(endpoint) } }}>
                <circle className="schematic-pin-hit" r="12" /><circle className="schematic-pin-dot" r="4" /><text x={point.x < 0 ? -10 : 10} y="-9" textAnchor={point.x < 0 ? 'end' : 'start'}>{pin}</text><title>{component.id}:{pin}</title>
              </g>
            })}
          </g>
        })}
        {!project.components.length && <text className="schematic-empty" x={minX + width / 2} y={minY + height / 2} textAnchor="middle">Add a source, passives, and ground to build an analog circuit.</text>}
      </svg>
    </div>
    {(result || invalidWires.length > 0) && <div className="schematic-diagnostics" aria-live="polite">
      {stale && <p className="schematic-warning">Project changed after solve. Run again for current measurements.</p>}
      {invalidWires.length > 0 && <p className="schematic-error">{invalidWires.length} wire(s) cannot be drawn: missing component or pin schema. Supply catalog pins for unsupported parts.</p>}
      {result?.diagnostics.map((diagnostic, index) => <p key={index} className={`schematic-${diagnostic.severity}`}>{diagnostic.severity.toUpperCase()}: {diagnostic.message}</p>)}
      {result?.ok && <p className="schematic-info">Real ngspice {result.analysis} · {result.solveMs.toFixed(0)} ms{result.time.length ? ` · ${result.time.length} samples (wire labels show last sample)` : ' · operating point'}</p>}
    </div>}
  </section>
}

export default SchematicCanvas
