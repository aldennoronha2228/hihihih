import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Info, Maximize, Redo2, RefreshCw, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { CatalogComponent, HardwareComponent, HardwareProject, WireEndpoint } from '../lib/hardware'
import { analogPins, sourceCatalog } from '../hardware/spice'
import type { AnalogSolveResult } from '../hardware/spice'
import './schematic-canvas.css'

export type SchematicCanvasProps = {
  project: HardwareProject; selectedId?: string | null; result?: AnalogSolveResult | null; catalog?: CatalogComponent[]
  onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void
  onConnect?: (from: WireEndpoint, to: WireEndpoint) => void
  onProbe?: (endpoint: WireEndpoint) => void
  probe?: WireEndpoint | null
  probeMode?: boolean
  showVoltages?: boolean
  onUndo?: () => void
  onReload?: () => void
}
type Point = { x: number; y: number }
type Drag = { id: string; origin: Point; start: Point; current: Point; moved: boolean }
export const wireKey = (endpoint: WireEndpoint) => `${endpoint.component}:${endpoint.pin}`

function pinNames(component: HardwareComponent, catalog: CatalogComponent[]): string[] {
  const analog = analogPins(component)
  if (analog.length) return analog
  const entry = catalog.find(item => (item.type ?? item.id) === component.type)
  return entry?.connectable === false ? [] : (entry?.pins ?? []).map(pin => typeof pin === 'string' ? pin : pin.name)
}

type Geometry = { kind: 'ic' | 'pair' | 'single' | 'bare'; bodyW: number; bodyH: number; stub: number; left: string[]; right: string[] }
const PITCH = 20

export function partGeometry(pins: string[]): Geometry {
  if (pins.length >= 3) {
    const left = pins.slice(0, Math.ceil(pins.length / 2)), right = pins.slice(Math.ceil(pins.length / 2))
    return { kind: 'ic', bodyW: 118, bodyH: Math.max(76, Math.max(left.length, right.length) * PITCH + 22), stub: 18, left, right }
  }
  if (pins.length === 2) return { kind: 'pair', bodyW: 56, bodyH: 30, stub: 18, left: [], right: [] }
  if (pins.length === 1) return { kind: 'single', bodyW: 40, bodyH: 28, stub: 18, left: [], right: [] }
  return { kind: 'bare', bodyW: 96, bodyH: 60, stub: 0, left: [], right: [] }
}

// Pin endpoint in unrotated part-local coordinates; wires, dots and hit areas share this math.
export function pinOffset(index: number, pins: string[], geom: Geometry): Point {
  if (geom.kind === 'ic') {
    const column = index < geom.left.length ? geom.left : geom.right
    const row = column.indexOf(pins[index])
    return { x: (index < geom.left.length ? -1 : 1) * (geom.bodyW / 2 + geom.stub), y: (row - (column.length - 1) / 2) * PITCH }
  }
  if (geom.kind === 'pair') return { x: index === 0 ? -(geom.bodyW / 2 + geom.stub) : geom.bodyW / 2 + geom.stub, y: 0 }
  if (geom.kind === 'single') return { x: 0, y: -(geom.bodyH / 2 + geom.stub) }
  return { x: 0, y: 0 }
}

function rotated(point: Point, rotation: number): Point {
  const angle = rotation * Math.PI / 180
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) }
}

export function PartBody({ type, name, id, pins, value, selected }: { type: string; name: string; id: string; pins: string[]; value?: string; selected?: boolean }) {
  const geom = partGeometry(pins)
  const half = geom.bodyW / 2, stubEnd = half + geom.stub
  const passive = /resistor/.test(type) ? 'resistor' : /capacitor/.test(type) ? 'capacitor' : /inductor/.test(type) ? 'inductor' : null
  const sourceKind = /current/.test(type) ? 'current' : /pulse/.test(type) ? 'pulse' : /sine|ac/.test(type) ? 'sine' : /pwl/.test(type) ? 'pwl' : /voltage/.test(type) ? 'voltage' : null
  return <g className={`schematic-body${selected ? ' is-selected' : ''}`}>
    {geom.kind === 'ic' && <>
      <rect className="schematic-body-rect" x={-half} y={-geom.bodyH / 2} width={geom.bodyW} height={geom.bodyH} rx={3} />
      {geom.left.map((pin, index) => <g key={`l${pin}`}>
        <line className="schematic-lead" x1={-half} x2={-stubEnd} y1={(index - (geom.left.length - 1) / 2) * PITCH} y2={(index - (geom.left.length - 1) / 2) * PITCH} />
        <text className="schematic-pin-label" x={-half + 7} y={(index - (geom.left.length - 1) / 2) * PITCH + 3}>{pin}</text>
      </g>)}
      {geom.right.map((pin, index) => <g key={`r${pin}`}>
        <line className="schematic-lead" x1={half} x2={stubEnd} y1={(index - (geom.right.length - 1) / 2) * PITCH} y2={(index - (geom.right.length - 1) / 2) * PITCH} />
        <text className="schematic-pin-label" x={half - 7} y={(index - (geom.right.length - 1) / 2) * PITCH + 3} textAnchor="end">{pin}</text>
      </g>)}
    </>}
    {geom.kind === 'pair' && <g>
      {passive === 'resistor' && <g><line className="schematic-lead" x1={-stubEnd} x2={-half} y1={0} y2={0} /><rect className="schematic-body-rect" x={-half} y={-11} width={geom.bodyW} height={22} rx={2} /><line className="schematic-lead" x1={half} x2={stubEnd} y1={0} y2={0} /></g>}
      {passive === 'inductor' && <g><line className="schematic-lead" x1={-stubEnd} x2={-half} y1={0} y2={0} /><path className="schematic-symbol" d={`M${-half} 0C${-half} -22 ${-half + 14} -22 ${-half + 14} 0S${-half + 28} -22 ${-half + 28} 0S${-half + 42} -22 ${-half + 42} 0S${-half + 56} -22 ${half} 0`} /><line className="schematic-lead" x1={half} x2={stubEnd} y1={0} y2={0} /></g>}
      {passive === 'capacitor' && <g><line className="schematic-lead" x1={-stubEnd} x2={-5} y1={0} y2={0} /><line className="schematic-symbol" x1={-5} x2={-5} y1={-14} y2={14} /><line className="schematic-symbol" x1={5} x2={5} y1={-14} y2={14} /><line className="schematic-lead" x1={5} x2={stubEnd} y1={0} y2={0} /></g>}
      {!passive && <g>
        <line className="schematic-lead" x1={-stubEnd} x2={-20} y1={0} y2={0} />
        <circle className="schematic-body-rect" r={20} />
        <line className="schematic-lead" x1={20} x2={stubEnd} y1={0} y2={0} />
        {sourceKind === 'current' ? <path className="schematic-symbol" d="M-9 0H9M4 -6L10 0L4 6" />
          : sourceKind === 'pulse' ? <path className="schematic-symbol" d="M-12 8H-5V-8H6V8H12" />
            : sourceKind === 'sine' ? <path className="schematic-symbol" d="M-11 0C-8 -14 -3 -14 0 0S8 14 11 0" />
              : sourceKind === 'pwl' ? <path className="schematic-symbol" d="M-12 9L-4 -8L3 4L12 -7" />
                : <g className="schematic-symbol"><path d="M-9 -6V6M-13 0H-5M5 0H13" /></g>}
      </g>}
      <text className="schematic-part-id" x={stubEnd + 8} y={-3}>{id}</text>
      <text className="schematic-part-value" x={stubEnd + 8} y={11}>{value}</text>
    </g>}
    {geom.kind === 'single' && (type === 'ground'
      ? <g className="schematic-symbol"><path d="M0 -18V0M-20 0H20M-13 9H13M-6 18H6" transform="translate(0 -32)" /></g>
      : <g><line className="schematic-lead" x1={0} x2={0} y1={-geom.bodyH / 2} y2={-geom.bodyH / 2 - geom.stub} /><rect className="schematic-body-rect" x={-half} y={-geom.bodyH / 2} width={geom.bodyW} height={geom.bodyH} rx={3} /></g>)}
    {geom.kind === 'bare' && <rect className="schematic-body-rect is-bare" x={-half} y={-geom.bodyH / 2} width={geom.bodyW} height={geom.bodyH} rx={4} />}
    <text className="schematic-part-title" textAnchor="middle" y={geom.kind === 'single' ? (type === 'ground' ? 8 : -(geom.bodyH / 2 + 34)) : geom.kind === 'bare' ? -(geom.bodyH / 2 + 14) : -(geom.bodyH / 2 + 12)}>{name.length > 26 ? `${name.slice(0, 25)}…` : name}</text>
    {geom.kind === 'ic' && <text className="schematic-part-id" textAnchor="middle" y={geom.bodyH / 2 + 18}>{id}</text>}
  </g>
}

export function SchematicSymbolPreview({ type, name, pins = [] }: { type: string; name: string; pins?: string[] }) {
  return <svg className="schematic-preview" viewBox="-98 -64 196 128" aria-hidden="true"><PartBody type={type} name={name} id="" pins={pins} /></svg>
}

export function SchematicCanvas({ project, selectedId, result, catalog = [], onSelect, onMove, onConnect, onProbe, probe, probeMode, showVoltages, onUndo, onReload }: SchematicCanvasProps) {
  const gridId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<WireEndpoint | null>(null)
  const [zoom, setZoom] = useState(1)
  const [labels, setLabels] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const fitted = useRef('')
  const stale = !!result && result.projectRevision !== project.revision
  const showVolt = !!showVoltages && !!result?.ok && !stale

  const pinMap = useMemo(() => new Map(project.components.map(component => [component.id, pinNames(component, catalog)])), [project.components, catalog])
  const geoms = useMemo(() => new Map(project.components.map(component => [component.id, partGeometry(pinMap.get(component.id)!)])), [project.components, pinMap])
  const valueMap = useMemo(() => new Map(project.components.map(component => {
    const defaults = sourceCatalog.find(entry => entry.type === component.type)?.defaultValues ?? {}
    const p = { ...defaults, ...component.properties }
    const text = /resistor/.test(component.type) ? `${String(p.value ?? '1k')} Ω`
      : /capacitor/.test(component.type) ? `${String(p.value ?? '1u')} F`
        : /inductor/.test(component.type) ? `${String(p.value ?? '1m')} H`
          : ['voltage-source', 'ac-source', 'source-dc-voltage', 'source-ac-voltage'].includes(component.type) ? `${String(p.voltage)} V DC`
            : ['current-source', 'source-dc-current'].includes(component.type) ? `${String(p.current)} A`
              : ['sine-source', 'source-sine-voltage'].includes(component.type) ? `${String(p.amplitude)} V · ${String(p.frequency)} Hz`
                : ['pulse-source', 'source-pulse-voltage'].includes(component.type) ? `${String(p.low)} → ${String(p.high)} V` : ''
    return [component.id, text]
  })), [project.components])
  const positions = new Map(project.components.map(component => [component.id, drag?.id === component.id ? drag.current : { x: component.x, y: component.y }]))

  const bounds = useMemo(() => {
    const extent = 104
    const xs = project.components.map(component => component.x), ys = project.components.map(component => component.y)
    const minX = (xs.length ? Math.min(...xs) : 0) - extent, minY = (ys.length ? Math.min(...ys) : 0) - extent - 24
    return { x: minX, y: minY, w: Math.max(760, (xs.length ? Math.max(...xs) : 400) + extent - minX), h: Math.max(460, (ys.length ? Math.max(...ys) : 260) + extent - minY) }
  }, [project.components])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const next = Math.max(.2, Math.min(1.6, Math.min((viewport.clientWidth - 36) / bounds.w, (viewport.clientHeight - 36) / bounds.h)))
    setZoom(next)
    viewport.scrollLeft = Math.max(0, (bounds.w * next - viewport.clientWidth) / 2)
    viewport.scrollTop = Math.max(0, (bounds.h * next - viewport.clientHeight) / 2)
  }, [bounds])
  useEffect(() => {
    if (fitted.current === project.id) return
    fitted.current = project.id
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [project.id, fit])

  const endpointPoint = (endpoint: WireEndpoint): Point | null => {
    const component = project.components.find(part => part.id === endpoint.component)
    const pins = pinMap.get(endpoint.component), position = positions.get(endpoint.component), geom = geoms.get(endpoint.component)
    const index = pins?.indexOf(endpoint.pin) ?? -1
    if (!component || !pins || !position || !geom || index < 0) return null
    const local = rotated(pinOffset(index, pins, geom), component.rotation)
    return { x: position.x + local.x, y: position.y + local.y }
  }

  const wirePaths = useMemo(() => project.wires.flatMap(wire => {
    const a = endpointPoint(wire.from), b = endpointPoint(wire.to)
    if (!a || !b) return []
    const mid = (a.x + b.x) / 2
    const net = result?.pinNetMap[wireKey(wire.from)] ?? result?.pinNetMap[wireKey(wire.to)]
    const voltage = showVolt && net ? result?.nodeVoltages[net]?.at(-1) : undefined
    return [{ wire, a, b, mid, net, voltage }]
  }), [project.wires, positions, pinMap, geoms, result, showVolt]) // eslint-disable-line react-hooks/exhaustive-deps

  const junctions = useMemo(() => {
    const counts = new Map<string, { point: Point; count: number }>()
    for (const path of wirePaths) for (const endpoint of [path.wire.from, path.wire.to]) {
      const point = endpointPoint(endpoint)
      if (!point) continue
      const entry = counts.get(wireKey(endpoint))
      if (entry) entry.count += 1
      else counts.set(wireKey(endpoint), { point, count: 1 })
    }
    return [...counts.values()].filter(entry => entry.count > 1)
  }, [wirePaths]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (probeMode) { onProbe?.(endpoint); return }
    if (!onConnect) return
    if (pending && project.components.some(component => component.id === pending.component)) {
      if (pending.component !== endpoint.component || pending.pin !== endpoint.pin) onConnect(pending, endpoint)
      setPending(null)
    } else setPending(endpoint)
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPending(null) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])
  const probePoint = probe ? endpointPoint(probe) : null
  const probeNet = probe ? result?.pinNetMap[wireKey(probe)] : undefined
  const probeVoltage = showVolt && probeNet ? result?.nodeVoltages[probeNet]?.at(-1) : undefined

  return <section className="schematic-canvas" aria-label="Schematic">
    <div className={`schematic-stage${probeMode ? ' is-probing' : ''}`}>
      <div className="schematic-viewport" ref={viewportRef}>
        <svg ref={svgRef} width={Math.round(bounds.w * zoom)} height={Math.round(bounds.h * zoom)} viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} role="img" aria-label="Circuit schematic">
          <defs><pattern id={gridId} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="schematic-grid-dot" /></pattern></defs>
          <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill={`url(#${gridId})`} />
          <g className="schematic-wires">{wirePaths.map(({ wire, a, b, mid, net, voltage }) => {
            const path = `M${a.x} ${a.y}H${mid}V${b.y}H${b.x}`
            return <g key={wire.id} className="schematic-wire-group" onClick={event => { event.stopPropagation(); if (probeMode) onProbe?.(wire.from) }}>
              <path className="schematic-wire-halo" d={path} />
              <path className="schematic-wire" d={path} style={{ stroke: wire.color || '#d7d7de' }} />
              <title>{wire.from.component}:{wire.from.pin} → {wire.to.component}:{wire.to.pin}{net ? ` · ${net}` : ''}</title>
              {labels && net && <text className="schematic-netlabel" x={a.y === b.y ? mid : mid + 7} y={a.y === b.y ? a.y - 7 : (a.y + b.y) / 2 + 3}>{net}</text>}
              {voltage !== undefined && <text className="schematic-voltage" x={a.x + 8} y={a.y - 9}>{voltage.toPrecision(3)} V</text>}
            </g>
          })}</g>
          {junctions.map(({ point }, index) => <circle key={index} className="schematic-junction" cx={point.x} cy={point.y} r={4.5} />)}
          {project.components.map(component => {
            const position = positions.get(component.id)!
            const pins = pinMap.get(component.id)!, geom = geoms.get(component.id)!
            const name = sourceCatalog.find(entry => entry.type === component.type)?.name ?? catalog.find(entry => (entry.type ?? entry.id) === component.type)?.name ?? component.type
            return <g key={component.id} className={`schematic-part${selectedId === component.id ? ' is-selected' : ''}${onMove ? ' is-movable' : ''}`} transform={`translate(${position.x} ${position.y})`}>
              <g role="button" tabIndex={0} aria-label={`Select ${component.id}, ${name}`} onClick={() => onSelect?.(component.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(component.id) } }} onPointerDown={event => startDrag(event, component)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
                <rect className="schematic-part-hit" x={-Math.max(90, geom.bodyW / 2 + 46)} y={-(geom.bodyH / 2 + 36)} width={Math.max(180, geom.bodyW + 92)} height={geom.bodyH + 70} />
                <g transform={`rotate(${component.rotation})`}>
                  <PartBody type={component.type} name={name} id={component.id} pins={pins} value={valueMap.get(component.id) ?? ''} selected={selectedId === component.id} />
                </g>
              </g>
              {pins.map((pin, index) => {
                const point = pinOffset(index, pins, geom)
                const endpoint = { component: component.id, pin }
                const isPending = pending?.component === component.id && pending.pin === pin
                const isProbe = probe?.component === component.id && probe.pin === pin
                return <g key={pin} className={`schematic-pin${isPending ? ' is-pending' : ''}${isProbe ? ' is-probe' : ''}`} role="button" tabIndex={0} aria-label={`${component.id} pin ${pin}`} transform={`translate(${point.x} ${point.y})`} onClick={event => { event.stopPropagation(); clickPin(endpoint) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); clickPin(endpoint) } }}>
                  <circle className="schematic-pin-dot" r={3.6} /><circle className="schematic-pin-hit" r={11} /><title>{component.id}:{pin}</title>
                </g>
              })}
            </g>
          })}
          {probePoint && <g className="schematic-probe-marker" transform={`translate(${probePoint.x} ${probePoint.y})`} pointerEvents="none"><circle r={9} /><circle r={3.5} /></g>}
          {!project.components.length && <text className="schematic-empty" x={bounds.x + bounds.w / 2} y={bounds.y + bounds.h / 2} textAnchor="middle">Place parts from the library, then wire their pins.</text>}
        </svg>
      </div>
      {probe && <div className="schematic-probe-readout" role="status">
        <span className="schematic-probe-dot" />
        <span>Probe <b>{probe.component}:{probe.pin}</b></span>
        <span className="schematic-probe-value">{probeVoltage !== undefined ? `${probeVoltage.toPrecision(4)} V` : probeNet ? probeNet : 'no data — run Bias'}</span>
        <button onClick={() => onProbe?.(probe)} aria-label="Clear probe">clear</button>
      </div>}
      <div className="schematic-canvasbar" role="toolbar" aria-label="Schematic canvas tools">
        {onUndo && <button aria-label="Undo last change" title="Undo" onClick={onUndo}><Undo2 size={14} /></button>}
        <button aria-label="Redo" disabled title="The backend keeps one undo level"><Redo2 size={14} /></button>
        <i />
        <button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.2, value - .1))}><ZoomOut size={14} /></button>
        <button className="schematic-zoom-reset" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2, value + .1))}><ZoomIn size={14} /></button>
        <button aria-label="Fit schematic" onClick={fit}><Maximize size={14} /></button>
        <i />
        {onReload && <button aria-label="Reload project" onClick={onReload}><RefreshCw size={14} /><span>Reload</span></button>}
        <i />
        <label className="schematic-labels-toggle"><span>Labels</span><input type="checkbox" role="switch" checked={labels} onChange={event => setLabels(event.target.checked)} /><i /></label>
        <i />
        <button aria-label="About the schematic" onClick={() => setInfoOpen(value => !value)}><Info size={14} /></button>
      </div>
      {infoOpen && <div className="schematic-info-pop" role="note">
        Drag a part to move it · click two pins to wire · turn on Probe, then click a pin or wire to measure it.
        Wire colors follow the Circuit view. Bias voltages come from the real ngspice operating point.
      </div>}
    </div>
  </section>
}

export default SchematicCanvas
