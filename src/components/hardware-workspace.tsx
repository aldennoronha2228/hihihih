import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, ChevronRight, CircuitBoard, Code2, Cpu, FolderOpen, LoaderCircle, Maximize, Minus, Play, Plus, RefreshCw, Save, Search, Square, Terminal, Trash2, Undo2, Waves, Wrench, X, Zap } from 'lucide-react'
import { ComponentRegistry } from '../../vendor/velxio/frontend/src/services/ComponentRegistry'
import { artifactIsCurrent, catalogPins, catalogType, hardwareApi, HardwareApiError, isHardwareProject } from '../lib/hardware'
import type { CatalogComponent, CompilerResult, Firmware, HardwareCommand, HardwareComponent, HardwarePin, HardwareProject, WireEndpoint } from '../lib/hardware'
import { HardwareRuntime } from '../hardware/runtime'
import type { RuntimeResults } from '../hardware/runtime'
import { HardwarePart } from '../hardware/part'
import './hardware-workspace.css'
import { WorkspaceLoading } from './ui/workspace-loading'

type WorkspaceTab = 'circuit' | 'agent' | 'parts'
type DockTab = 'compiler' | 'serial' | 'results' | 'tools'
export type HardwareWorkspaceView = 'circuit' | 'schematic'
export type HardwareWorkspaceProps = {
  chatSlot?: ReactNode; children?: ReactNode; onProjectChange?: (project: HardwareProject | null) => void
  schematicSlot?: ReactNode; oscilloscopeSlot?: ReactNode; analysisSlot?: ReactNode
  onRuntimeChange?: (runtime: HardwareRuntime | null) => void
  onResultsChange?: (results: RuntimeResults | null) => void
  view?: HardwareWorkspaceView; onViewChange?: (view: HardwareWorkspaceView) => void
}

const categoryNames: Record<string, string> = {
  boards: 'Microcontrollers', sensors: 'Sensors', displays: 'Displays', input: 'Inputs', output: 'Outputs',
  passive: 'Passives', analog: 'Analog', motors: 'Motors', communication: 'Communication', logic: 'Logic', other: 'Other components',
}

type WorkspaceLayout = { sidebar: number; agent: number; dock: number }
const layoutKey = 'wireup.workspace.layout.v1'
const defaultLayout: WorkspaceLayout = { sidebar: 232, agent: 340, dock: 216 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const readLayout = (): WorkspaceLayout => {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey) || '') as Partial<WorkspaceLayout>
    return {
      sidebar: clamp(Number(saved.sidebar) || defaultLayout.sidebar, 180, 480),
      agent: clamp(Number(saved.agent) || defaultLayout.agent, 260, 680),
      dock: clamp(Number(saved.dock) || defaultLayout.dock, 96, 480),
    }
  } catch { return defaultLayout }
}

const generatedPreviews = new Set(Object.keys(import.meta.glob('/public/component-previews/*.png')).map(path => path.split('/').pop()!.replace('.png', '')))

function CatalogThumbnail({ type, name, thumbnail }: { type: string; name: string; thumbnail?: string }) {
  const host = useRef<HTMLSpanElement>(null)
  const preview = thumbnail?.trim().startsWith('<svg') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumbnail)}` : thumbnail || (generatedPreviews.has(type) ? `/component-previews/${type}.png` : `/component-svgs/${type}.svg`)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    if (!imageFailed) return
    let active = true
    let cleanup: (() => void) | undefined
    const container = host.current
    void ComponentRegistry.getInstance().load().then(() => {
      const metadata = ComponentRegistry.getInstance().getById(type)
      if (!active || !host.current || !metadata || !customElements.get(metadata.tagName)) return
      const element = document.createElement(metadata.tagName)
      Object.assign(element, metadata.defaultValues)
      host.current.replaceChildren(element)
      const fit = () => {
        if (!active || !host.current) return
        const scale = Math.min(1, 65 / Math.max(element.offsetWidth, 1), 49 / Math.max(element.offsetHeight, 1))
        element.style.transform = `translate(-50%, -50%) scale(${scale})`
      }
      requestAnimationFrame(fit)
      const observer = new ResizeObserver(fit)
      observer.observe(element)
      cleanup = () => observer.disconnect()
    }).catch(() => {})
    return () => { active = false; cleanup?.(); container?.replaceChildren() }
  }, [imageFailed, type])
  return <span className="hw-catalog-art" aria-hidden="true">{!imageFailed ? <img src={preview} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span ref={host} className="hw-catalog-element"><Cpu size={22} /></span>}<span className="hw-thumbnail-name">{name}</span></span>
}

export function HardwareWorkspace({ chatSlot, children, onProjectChange, schematicSlot, oscilloscopeSlot, analysisSlot, onRuntimeChange, onResultsChange, view, onViewChange }: HardwareWorkspaceProps) {
  const { projectId } = useParams<{ projectId: string }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [project, setProject] = useState<HardwareProject | null>(null)
  const projectRef = useRef<HardwareProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState('')
  const sourceRef = useRef('')
  const savedSource = useRef('')
  const draftRevision = useRef<number | null>(null)
  const [catalog, setCatalog] = useState<CatalogComponent[]>([])
  const [knownCatalog, setKnownCatalog] = useState<CatalogComponent[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<WorkspaceTab>('circuit')
  const [dock, setDock] = useState<DockTab>('compiler')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [sketchOpen, setSketchOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [localView, setLocalView] = useState<HardwareWorkspaceView>('circuit')
  const activeView = view ?? localView
  const canvasViewport = useRef<HTMLDivElement>(null)
  const sketchDialog = useRef<HTMLDialogElement>(null)
  const scopeDialog = useRef<HTMLDialogElement>(null)
  const [connection, setConnection] = useState('Disconnected')
  const [runtime, setRuntime] = useState<HardwareRuntime | null>(null)
  useEffect(() => { onRuntimeChange?.(runtime); return () => onRuntimeChange?.(null) }, [runtime, onRuntimeChange])
  const [results, setResults] = useState<RuntimeResults | null>(null)
  useEffect(() => { onResultsChange?.(results) }, [results, onResultsChange])
  const [compiler, setCompiler] = useState<CompilerResult | null>(null)
  const [pins, setPins] = useState<Record<string, HardwarePin[]>>({})
  const [wireStart, setWireStart] = useState<WireEndpoint | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [wireColor, setWireColor] = useState('#a3e635')
  const [serialInput, setSerialInput] = useState('')
  const [expression, setExpression] = useState('')
  const [toolOutput, setToolOutput] = useState('')
  const [properties, setProperties] = useState('{}')
  const [position, setPosition] = useState({ x: 0, y: 0, rotation: 0 })
  const [zoom, setZoom] = useState(1)
  const [session, setSession] = useState(0)
  const [layout, setLayout] = useState<WorkspaceLayout>(readLayout)
  const [resizing, setResizing] = useState<'sidebar' | 'agent' | 'dock' | null>(null)
  useEffect(() => { try { localStorage.setItem(layoutKey, JSON.stringify(layout)) } catch { /* Layout resets if storage is unavailable. */ } }, [layout])
  const busyRef = useRef(false)

  // Drag a panel edge to resize it; sizes clamp so the canvas always keeps room.
  const startResize = (kind: 'sidebar' | 'agent' | 'dock') => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const horizontal = kind !== 'dock'
    const origin = horizontal ? event.clientX : event.clientY
    const start = layout[kind]
    setResizing(kind)
    document.body.classList.add('hw-resizing', horizontal ? 'hw-resizing-col' : 'hw-resizing-row')
    const move = (moveEvent: PointerEvent) => {
      const delta = horizontal ? moveEvent.clientX - origin : moveEvent.clientY - origin
      setLayout(previous => {
        if (kind === 'sidebar') return { ...previous, sidebar: clamp(start + delta, 180, Math.max(200, Math.min(480, window.innerWidth - previous.agent - 320))) }
        if (kind === 'agent') return { ...previous, agent: clamp(start - delta, 260, Math.max(280, Math.min(680, window.innerWidth - previous.sidebar - 320))) }
        return { ...previous, dock: clamp(start - delta, 96, Math.max(120, Math.min(480, Math.round(window.innerHeight * .7)))) }
      })
    }
    const finish = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish)
      document.body.classList.remove('hw-resizing', 'hw-resizing-col', 'hw-resizing-row')
      setResizing(null)
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish)
  }

  const acceptProject = useCallback((next: HardwareProject, forceSource = false) => {
    const previous = projectRef.current
    if (previous?.id === next.id && (previous.revision > next.revision || (!forceSource && JSON.stringify(previous) === JSON.stringify(next)))) return
    if (!next.runtime_token && previous?.id === next.id) next = { ...next, runtime_token: previous.runtime_token }
    projectRef.current = next
    setProject(next)
    setCompiler(next.compiler)
    if (forceSource || !previous || previous.id !== next.id || sourceRef.current === savedSource.current) {
      sourceRef.current = next.firmware.source
      setSource(next.firmware.source)
      draftRevision.current = next.revision
    }
    savedSource.current = next.firmware.source
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true); setLoadError(''); setError(''); setProject(null); projectRef.current = null
    setSelected(''); setPins({}); setResults(null); setWireStart(null)
    if (!projectId) {
      setLoadError('No project was selected. Open a prototype from the home page.')
      setLoading(false)
      return
    }
    void hardwareApi.getProject(projectId, { signal: controller.signal }).then(value => {
      if (active) acceptProject(value, true)
    }).catch(error => { if (active) setLoadError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [projectId, acceptProject, loadAttempt])

  useEffect(() => { onProjectChange?.(project) }, [project, onProjectChange])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void hardwareApi.catalog('', 200, { signal: controller.signal }).then(async value => {
      const registry = ComponentRegistry.getInstance()
      await registry.load()
      for (const board of value.boards) {
        const id = catalogType(board)
        if (registry.getById(id) || !board.tagName) continue
        const alias = id === 'pi-pico' ? 'raspberry-pi-pico' : id === 'pi-pico-w' ? 'raspberry-pi-pico-w' : id
        const metadata = registry.getById(alias)
        if (metadata) registry.mergeComponents([{ ...metadata, id, tagName: board.tagName }])
      }
      if (active) setKnownCatalog([...value.components, ...value.boards])
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false; controller.abort() }
  }, [loadAttempt])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void hardwareApi.catalog(query, 200, { signal: controller.signal }).then(value => {
        if (active) setCatalog([...value.components, ...value.boards].filter((part, index, all) => all.findIndex(other => catalogType(other) === catalogType(part)) === index))
      }).catch(error => { if (active) setError(error.message) })
    }, 200)
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    const current = projectRef.current
    if (!current || current.id !== projectId) return
    const bridge = new HardwareRuntime(setResults)
    bridge.connect(current, setConnection, acceptProject)
    setRuntime(bridge)
    return () => { bridge.dispose(); setRuntime(null) }
  }, [project?.id, projectId, session, acceptProject])

  useEffect(() => {
    if (!projectId || projectRef.current?.id !== projectId) return
    let active = true
    let inFlight: AbortController | null = null
    const refresh = () => {
      if (!active || inFlight || busyRef.current || document.hidden) return
      const controller = new AbortController()
      inFlight = controller
      void hardwareApi.getProject(projectId, { signal: controller.signal }).then(next => { if (active) acceptProject(next) })
        .catch(error => { if (active && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to refresh the project.') })
        .finally(() => { if (inFlight === controller) inFlight = null })
    }
    const timer = setInterval(refresh, 2000)
    window.addEventListener('focus', refresh)
    const agentRefresh = (event: Event) => { if ((event as CustomEvent<string>).detail === projectId) refresh() }
    window.addEventListener('wireup-project-updated', agentRefresh)
    return () => { active = false; inFlight?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('wireup-project-updated', agentRefresh) }
  }, [projectId, project?.id, acceptProject])

  const perform = async (label: string, task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setError(''); setNotice('')
    try { await task() } catch (error) {
      setError(error instanceof Error ? error.message : 'Hardware operation failed.')
      if (error instanceof HardwareApiError && error.status === 409 && projectRef.current) {
        try { acceptProject(await hardwareApi.getProject(projectRef.current.id)) } catch { /* Keep the original conflict visible. */ }
      }
    } finally { busyRef.current = false; setBusy('') }
  }
  const command = async (name: HardwareCommand, args: Record<string, unknown> = {}, mutation = false) => {
    const current = projectRef.current
    if (!current) throw new Error('Open a project first.')
    const value = await hardwareApi.command<unknown>(current, name, { ...args, ...(mutation ? { expected_revision: current.revision } : {}) }, {
      compileTimeoutSeconds: knownCatalog.find(item => catalogType(item) === current.board)?.compile_timeout_seconds,
    })
    if (isHardwareProject(value)) {
      acceptProject(value, name === 'undo')
      if (value.board !== current.board) setNotice(`Selected ${value.board}. ${knownCatalog.find(item => catalogType(item) === value.board)?.unavailable_reason || knownCatalog.find(item => catalogType(item) === value.board)?.description || 'Compile capabilities depend on the selected board; native simulation may require additional setup.'}`)
    }
    return value
  }
  const saveSource = async () => {
    const current = projectRef.current
    if (current && sourceRef.current !== current.firmware.source) {
      const next = await hardwareApi.command<HardwareProject>(current, 'edit_firmware', { source: sourceRef.current, expected_revision: draftRevision.current ?? current.revision })
      acceptProject(next, true)
    }
  }
  const dirty = !!project && source !== project.firmware.source
  const mutationDisabled = !!busy || !!results?.running || dirty
  const selectedPart = project?.components.find(part => part.id === selected)
  useEffect(() => {
    if (!selectedPart) return
    setProperties(JSON.stringify(selectedPart.properties, null, 2))
    setPosition({ x: selectedPart.x, y: selectedPart.y, rotation: selectedPart.rotation })
  }, [selectedPart])

  const pinsChanged = useCallback((id: string, info: HardwarePin[]) => {
    setPins(previous => JSON.stringify(previous[id]) === JSON.stringify(info) ? previous : { ...previous, [id]: info })
  }, [])
  const catalogFor = (part: HardwareComponent) => knownCatalog.find(item => catalogType(item) === part.type)
  const endpointOptions = project?.components.flatMap(part => catalogPins(catalogFor(part)).map(pin => ({ value: JSON.stringify({ component: part.id, pin }), label: `${part.id} · ${pin}` }))) ?? []
  const pinPosition = (endpoint: WireEndpoint) => {
    const part = project?.components.find(part => part.id === endpoint.component)
    const info = pins[endpoint.component] ?? []
    const aliases = [endpoint.pin, endpoint.pin.replace(/^D(?=\d)/, ''), endpoint.pin === 'GND' ? 'GND.1' : endpoint.pin, endpoint.pin === 'TX' ? '1' : endpoint.pin === 'RX' ? '0' : endpoint.pin]
    const pin = aliases.map(name => info.find(pin => pin.name === name)).find(Boolean)
    if (!part || pin?.x === undefined || pin.y === undefined) return null
    const radians = part.rotation * Math.PI / 180
    return { x: part.x + pin.x * Math.cos(radians) - pin.y * Math.sin(radians), y: part.y + pin.x * Math.sin(radians) + pin.y * Math.cos(radians) }
  }
  const unresolvedWires = project?.wires.filter(wire => !pinPosition(wire.from) || !pinPosition(wire.to)) ?? []
  const choosePin = (endpoint: WireEndpoint) => {
    if (mutationDisabled) return
    if (!wireStart) { setWireStart(endpoint); return }
    if (JSON.stringify(endpoint) === JSON.stringify(wireStart)) { setWireStart(null); return }
    void perform('Connecting wire', async () => {
      await command('connect_wire', { from: wireStart, to: endpoint, color: wireColor }, true)
      setWireStart(null)
    })
  }
  const agent = chatSlot ?? children
  const visibleCatalog = catalog
  const categories = [...new Set(visibleCatalog.map(item => item.category ?? 'other'))].sort((a, b) => {
    const order = ['boards', 'input', 'output', 'sensors', 'displays', 'passive', 'analog', 'motors', 'communication', 'logic', 'other']
    return order.indexOf(a) - order.indexOf(b)
  })
  const selectedBoard = knownCatalog.find(item => catalogType(item) === project?.board)
  const runBlocker = !project || project.board === 'unselected' ? 'Select a board before running a simulation.'
    : selectedBoard?.simulation === 'unavailable' ? `Simulation is currently unavailable for ${selectedBoard.name}. You can still build the circuit and write source code. ${selectedBoard.unavailable_reason || ''}`
    : dirty ? 'Save and compile your firmware changes before running.'
    : !artifactIsCurrent(project) ? 'Compile the current firmware for this board before running.'
    : connection !== 'Connected' ? `Browser runtime: ${connection}. Close other tabs using this project, then reconnect.`
    : busy ? 'Wait for the current operation to finish.' : ''
  const changeView = (next: HardwareWorkspaceView) => { setLocalView(next); onViewChange?.(next); setTab('circuit') }
  const fitCanvas = () => {
    const viewport = canvasViewport.current
    if (!viewport) return
    setZoom(Math.min(1.5, Math.max(.25, Math.min((viewport.clientWidth - 60) / 1000, (viewport.clientHeight - 60) / 650))))
    viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }
  useEffect(() => {
    const dialog = sketchDialog.current
    if (sketchOpen && dialog && !dialog.open) dialog.showModal()
    if (!sketchOpen && dialog?.open) dialog.close()
  }, [sketchOpen])
  useEffect(() => {
    // The schematic studio's Sketch button shares this firmware editor.
    const open = () => setSketchOpen(true)
    window.addEventListener('wireup:open-sketch', open)
    return () => window.removeEventListener('wireup:open-sketch', open)
  }, [])
  useEffect(() => {
    const dialog = scopeDialog.current
    if (scopeOpen && dialog && !dialog.open) dialog.showModal()
    if (!scopeOpen && dialog?.open) dialog.close()
  }, [scopeOpen])

  return <main className="hardware-workspace" data-mobile-tab={tab}>
    <header className="hw-header">
      <Link to="/" className="hw-brand" aria-label="WireUp home"><img src="/wireup-logo.png" alt="" /><span>WireUp</span></Link>
      <span className="hw-header-divider" /><Link to="/projects" className="hw-project-link"><FolderOpen size={15} /> Projects</Link>
      {project && <><ChevronRight size={14} className="hw-muted" /><span className="hw-project-title">{project.name}</span><span className="hw-chip">{project.board === 'unselected' ? 'Board not selected' : project.board}</span></>}
      <span className="hw-header-spacer" /><span className="hw-local"><span /> Local workspace</span>
      <Link to="/" className="hw-icon-button" aria-label="Back to chat"><ArrowLeft size={16} /></Link>
    </header>
    {error && <div role="alert" className="hw-alert"><span>{error}</span>{dirty && project && <button onClick={() => { acceptProject(project, true); setError(''); setNotice('Loaded server firmware. Unsaved editor changes discarded.') }}>Load server firmware</button>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {notice && <div role="status" className="hw-notice">{notice}</div>}
    {loading ? <WorkspaceLoading/> : !project ? <section className="flex min-h-0 flex-1 items-center justify-center p-6"><div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6"><h1 className="text-lg font-semibold">Unable to open this project</h1><p role="alert" className="mt-3 text-sm leading-6 text-neutral-400">{loadError || 'The project could not be loaded.'}</p><p className="mt-3 text-xs leading-5 text-neutral-500">If the hardware service is unavailable, start the backend and retry. Project creation remains on the WireUp home page.</p><div className="mt-5 flex flex-wrap gap-3">{projectId && <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="rounded-lg bg-[#4a8fd9] px-4 py-2 text-sm font-medium text-white">Retry loading</button>}<Link to="/" className="rounded-lg border border-neutral-700 px-4 py-2 text-sm">Back to home</Link><Link to="/projects" className="rounded-lg border border-neutral-700 px-4 py-2 text-sm">All projects</Link></div></div></section> : <>
      <nav className="hw-mobile-tabs" aria-label="Workspace panels">{(['circuit', 'parts', 'agent'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value === 'circuit' ? 'Canvas' : value === 'parts' ? 'Parts' : 'Agent'}</button>)}</nav>
      <div className={`hw-workbench${activeView === 'schematic' ? ' is-schematic' : ''}`} style={{ '--hw-sidebar': `${layout.sidebar}px`, '--hw-agent': `${layout.agent}px` } as CSSProperties}>
        <div className="hw-resizer hw-resizer-col" data-side="left" data-active={resizing === 'sidebar'} role="separator" aria-orientation="vertical" aria-label="Resize components panel" onPointerDown={startResize('sidebar')} />
        <div className="hw-resizer hw-resizer-col" data-side="right" data-active={resizing === 'agent'} role="separator" aria-orientation="vertical" aria-label="Resize agent panel" onPointerDown={startResize('agent')} />
        <aside className="hw-sidebar hw-parts-panel">
          <div className="hw-panel-heading"><Cpu size={15} /> Components <span>{project.components.length}</span></div>
          <label className="hw-search"><Search size={14} /><input aria-label="Search components" placeholder="Search catalog…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="hw-catalog">{categories.map(category => <details className="hw-category" key={category} open><summary>{categoryNames[category] ?? category}<span>{visibleCatalog.filter(item => (item.category ?? 'other') === category).length}</span><ChevronDown size={12} /></summary><div className="hw-category-grid">{visibleCatalog.filter(item => (item.category ?? 'other') === category).map(item => <button key={catalogType(item)} className="hw-catalog-card" aria-label={`Add ${item.name} ${item.category ?? 'component'}`} title={item.description ?? item.name} disabled={mutationDisabled || (item.category === 'boards' && item.supported_board === false) || catalogType(item) === project.board} onClick={() => void perform('Adding component', async () => { const count = projectRef.current?.components.length ?? 0; await command('add_component', { type: catalogType(item), x: 380 + count % 3 * 110, y: 100 + Math.floor(count / 3) * 110 }, true) })}><CatalogThumbnail type={catalogType(item)} name={item.name} thumbnail={item.thumbnail} /><strong>{item.name}</strong><small>{item.category === 'boards' ? item.simulation === 'browser' ? 'Browser simulation' : item.compile ? 'Compile · emulator setup needed' : 'Placement · native runtime needed' : !catalogPins(item).length ? 'Placement only' : `${catalogPins(item).length} verified pins`}</small><Plus className="hw-card-add" size={12} /></button>)}</div></details>)}{!visibleCatalog.length && <p className="hw-catalog-empty">No components match your search.</p>}</div>
          <div className="hw-panel-heading">In this circuit</div>
          <div className="hw-component-list">{project.components.map(part => <button key={part.id} className={selected === part.id ? 'active' : ''} onClick={() => setSelected(part.id)}><Cpu size={14} /><span>{part.id}<small>{part.type}</small></span></button>)}</div>
          {selectedPart && <section className="hw-inspector"><div className="hw-panel-heading">Properties <button aria-label={`Remove ${selectedPart.id}`} disabled={mutationDisabled || selectedPart.type === 'arduino-uno'} onClick={() => void perform('Removing component', async () => { await command('remove_component', { id: selectedPart.id }, true); setSelected('') })}><Trash2 size={13} /></button></div>
            <div className="hw-position">{(['x', 'y', 'rotation'] as const).map(key => <label key={key}>{key}<input aria-label={`Component ${key}`} type="number" value={position[key]} onChange={event => setPosition({ ...position, [key]: Number(event.target.value) })} /></label>)}</div>
            <textarea aria-label="Component properties JSON" value={properties} onChange={event => setProperties(event.target.value)} rows={4} spellCheck={false} />
            <button disabled={mutationDisabled} onClick={() => void perform('Updating component', async () => { const value: unknown = JSON.parse(properties); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Properties must be a JSON object.'); await command('modify_component', { id: selectedPart.id, ...position, properties: value }, true) })}><Check size={14} /> Apply properties</button>
          </section>}
          <section className="hw-wiring"><div className="hw-panel-heading">Connections <span>{project.wires.length}</span></div>
            <select aria-label="Wire from pin" value={from} onChange={event => setFrom(event.target.value)}><option value="">From pin…</option>{endpointOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select aria-label="Wire to pin" value={to} onChange={event => setTo(event.target.value)}><option value="">To pin…</option>{endpointOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <div className="hw-wire-add"><input type="color" aria-label="Wire color" value={wireColor} onChange={event => setWireColor(event.target.value)} /><button disabled={mutationDisabled || !from || !to || from === to} onClick={() => void perform('Connecting wire', async () => { await command('connect_wire', { from: JSON.parse(from), to: JSON.parse(to), color: wireColor }, true); setFrom(''); setTo('') })}><Plus size={13} /> Connect</button></div>
            {project.wires.map(wire => <div className="hw-wire-row" key={wire.id}><i style={{ background: wire.color }} /><span>{wire.from.component}.{wire.from.pin}<small>→ {wire.to.component}.{wire.to.pin}</small></span><button aria-label={`Delete wire ${wire.id}`} disabled={mutationDisabled} onClick={() => void perform('Deleting wire', async () => { await command('remove_wire', { id: wire.id }, true) })}><Trash2 size={12} /></button></div>)}
          </section>
        </aside>
        <section className="hw-center">
      <nav className="hw-toolbar" aria-label="Hardware actions">
        <div className="hw-view-tabs" role="tablist" aria-label="Design view"><button role="tab" aria-selected={activeView === 'circuit'} onClick={() => changeView('circuit')}><CircuitBoard size={15} /> Circuit</button><button role="tab" aria-selected={activeView === 'schematic'} onClick={() => changeView('schematic')}><Zap size={15} /> Schematic</button></div>
        <div className="hw-actions">
          {activeView === 'circuit' && analysisSlot}
          {activeView === 'circuit' && <button className="hw-sketch-button" aria-haspopup="dialog" onClick={() => { setTab('circuit'); setSketchOpen(true) }}><Code2 size={15} /><span>Sketch</span>{dirty && <i className="hw-unsaved" />}</button>}
          {activeView === 'circuit' && <button className="hw-scope-button" aria-haspopup="dialog" onClick={() => { setTab('circuit'); setScopeOpen(true) }}><Waves size={15} /><span>Oscilloscope</span></button>}
          <button aria-label="Save" disabled={!!busy || !!results?.running} onClick={() => void perform('Saving firmware', async () => { await saveSource(); setNotice('Firmware saved to the canonical project.') })}><Save size={15} /><span>Save</span>{dirty && <i className="hw-unsaved" />}</button>
          <button aria-label="Undo last change" disabled={mutationDisabled || !project.history.length} onClick={() => void perform('Undoing', async () => { await command('undo', {}, true) })}><Undo2 size={15} /></button>
          <button disabled={!!busy || !!results?.running || project.board === 'unselected' || knownCatalog.find(item => catalogType(item) === project.board)?.compile === false} onClick={() => void perform('Compiling firmware', async () => { await saveSource(); const value = await command('compile_firmware', {}, true) as CompilerResult; setCompiler(value); setDock('compiler'); setConsoleOpen(true); setSketchOpen(false); setTab('circuit'); if (projectRef.current) acceptProject(await hardwareApi.getProject(projectRef.current.id)); setNotice(value.status === 'simulation_ready' ? 'Firmware compiled. Ready for browser simulation.' : 'Firmware compiled, but this board needs a native runtime to simulate. Review diagnostics below.') })}><Wrench size={15} /><span>{busy === 'Compiling firmware' ? 'Compiling…' : 'Compile'}</span></button>
          {results?.running ? <button className="hw-stop" disabled={!!busy || connection !== 'Connected'} onClick={() => void perform('Stopping simulation', async () => { await command('stop_simulation') })}><Square size={14} fill="currentColor" /> Stop</button> : <button className="hw-primary" title={runBlocker || 'Run compiled firmware in the browser emulator'} disabled={!!runBlocker} onClick={() => void perform('Starting simulation', async () => { await command('run_simulation'); setDock('results') })}><Play size={14} fill="currentColor" /> Run</button>}
        </div>
      </nav>
      {!results?.running && runBlocker && <div role="status" className="hw-notice">{runBlocker}{connection !== 'Connected' && project?.board !== 'unselected' && selectedBoard?.simulation !== 'unavailable' && <button className="ml-3 underline" onClick={() => setSession(value => value + 1)}>Reconnect runtime</button>}</div>}

          <div className="hw-design-surface">
          <div className="hw-circuit-panel" hidden={activeView !== 'circuit'}>
            {!project.components.length && <p className="p-4 text-center text-xs text-neutral-400">Your canvas is empty. Describe your project and answer the questions; the agent will select and place the board after confirmation.</p>}
            {unresolvedWires.length > 0 && <p className="hw-notice" role="status">{unresolvedWires.length} connection(s) are saved but their component pin layout is not ready. {unresolvedWires.map(wire => `${wire.from.component}.${wire.from.pin} → ${wire.to.component}.${wire.to.pin}`).join('; ')}</p>}
            <div className="hw-canvas-viewport" ref={canvasViewport} aria-label="Circuit canvas"><div className="hw-canvas" style={{ width: 1000 * zoom, height: 650 * zoom }}><div className="hw-canvas-world" style={{ transform: `scale(${zoom})` }}>
              <svg className="hw-wires" width="1000" height="650" aria-label="Circuit wires">{project.wires.map(wire => { const start = pinPosition(wire.from); const end = pinPosition(wire.to); return start && end ? <path key={wire.id} d={`M ${start.x} ${start.y} H ${(start.x + end.x) / 2} V ${end.y} H ${end.x}`} stroke={wire.color} fill="none" strokeWidth="3" /> : null })}</svg>
              {project.components.map(part => <div key={part.id} className={`hw-canvas-part ${selected === part.id ? 'selected' : ''}`} style={{ left: part.x, top: part.y, transform: `rotate(${part.rotation}deg)` }} onClick={() => setSelected(part.id)}>
                <button className="hw-part-handle" aria-label={`Select ${part.id}`} onPointerDown={event => {
                  if (mutationDisabled) return
                  const target = event.currentTarget
                  target.setPointerCapture(event.pointerId)
                  const startX = event.clientX; const startY = event.clientY
                  const move = (moveEvent: PointerEvent) => { const wrapper = target.parentElement; if (wrapper) { wrapper.style.left = `${Math.max(0, part.x + (moveEvent.clientX - startX) / zoom)}px`; wrapper.style.top = `${Math.max(30, part.y + (moveEvent.clientY - startY) / zoom)}px` } }
                  const up = (upEvent: PointerEvent) => {
                    target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel)
                    const x = Math.round(Math.max(0, part.x + (upEvent.clientX - startX) / zoom)); const y = Math.round(Math.max(30, part.y + (upEvent.clientY - startY) / zoom))
                    if (x !== part.x || y !== part.y) void perform('Moving component', async () => { try { await command('modify_component', { id: part.id, x, y }, true) } finally { const wrapper = target.parentElement; const canonical = projectRef.current?.components.find(item => item.id === part.id); if (wrapper && canonical) { wrapper.style.left = `${canonical.x}px`; wrapper.style.top = `${canonical.y}px` } } })
                  }
                  const cancel = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel); if (target.parentElement) { target.parentElement.style.left = `${part.x}px`; target.parentElement.style.top = `${part.y}px` } }
                  target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', cancel)
                }}>{part.id}</button>
                <HardwarePart part={part} runtime={runtime} pinsChanged={pinsChanged} />
                {(pins[part.id] ?? []).filter(pin => catalogPins(catalogFor(part)).includes(pin.name) && pin.x !== undefined && pin.y !== undefined).map(pin => <button key={pin.name} title={`${part.id}.${pin.name}`} aria-label={`Connect ${part.id} pin ${pin.name}`} className={`hw-pin ${wireStart?.component === part.id && wireStart.pin === pin.name ? 'active' : ''}`} style={{ left: pin.x, top: pin.y }} disabled={mutationDisabled} onClick={event => { event.stopPropagation(); choosePin({ component: part.id, pin: pin.name }) }} />)}
              </div>)}
            </div></div></div>
            <div className="hw-canvas-hint">{wireStart ? <><Zap size={12} /> Select a second pin to connect <button onClick={() => setWireStart(null)}>Cancel</button></> : <><Zap size={12} /> Drag component labels to move · Click verified pins to wire</>}<span>Uno · 16 MHz</span></div>
          </div>
          <section className="hw-schematic-panel" hidden={activeView !== 'schematic'} aria-label="Schematic view">{schematicSlot ?? <div className="hw-schematic-empty"><CircuitBoard size={30} /><h2>Schematic view</h2><p>The schematic renderer is supplied by the host application. Your canonical circuit and connections are unchanged.</p></div>}</section>
          {activeView === 'circuit' && <div className="hw-floating-tools" aria-label="Canvas controls"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.25, value - .1))}><Minus size={15} /></button><button aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2, value + .1))}><Plus size={15} /></button><i /><button aria-label="Fit circuit" onClick={fitCanvas}><Maximize size={15} /></button><button aria-label="Reset canvas view" onClick={() => { setZoom(1); canvasViewport.current?.scrollTo({ left: 0, top: 0 }) }}><RefreshCw size={15} /></button><span className={results?.running ? 'hw-running' : ''}>{results?.running ? '● Running' : '○ Stopped'}</span></div>}
          </div>
          <dialog ref={sketchDialog} className="hw-sketch-dialog" aria-label="Sketch firmware editor" onCancel={() => setSketchOpen(false)} onClose={() => setSketchOpen(false)}><section className="hw-firmware-panel"><div className="hw-panel-heading"><Code2 size={15} /> {project.firmware.filename}<span>{dirty ? 'Unsaved edits' : `Saved · r${project.firmware.revision}`}</span><button aria-label="Close Sketch" onClick={() => setSketchOpen(false)}><X size={16} /></button></div><div className="hw-code-editor"><div aria-hidden="true" className="hw-line-numbers">{source.split('\n').map((_, index) => <div key={index}>{index + 1}</div>)}</div><textarea aria-label="Firmware source" value={source} spellCheck={false} disabled={!!results?.running} onChange={event => { if (sourceRef.current === savedSource.current) draftRevision.current = projectRef.current?.revision ?? null; setSource(event.target.value); sourceRef.current = event.target.value }} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd; const next = source.slice(0, start) + '  ' + source.slice(end); if (sourceRef.current === savedSource.current) draftRevision.current = projectRef.current?.revision ?? null; setSource(next); sourceRef.current = next; const textarea = event.currentTarget; requestAnimationFrame(() => { textarea.setSelectionRange(start + 2, start + 2) }) } }} /></div><footer className="hw-sketch-footer"><span>Arduino C++ · Canonical server firmware</span><button aria-label="Save sketch" disabled={!!busy || !!results?.running} onClick={() => void perform('Saving firmware', async () => { await saveSource(); setSketchOpen(false); setTab('circuit'); setNotice('Firmware saved to the canonical project.') })}><Save size={14} /> Save sketch</button></footer></section></dialog>
          <dialog ref={scopeDialog} className="hw-scope-dialog" aria-label="Oscilloscope" onCancel={() => setScopeOpen(false)} onClose={() => setScopeOpen(false)}><div className="hw-panel-heading"><Waves size={16} /> Oscilloscope<button aria-label="Close Oscilloscope" onClick={() => setScopeOpen(false)}><X size={16} /></button></div>{oscilloscopeSlot ?? <div className="hw-schematic-empty"><Waves size={30} /><h2>Runtime instruments</h2><p>The host application provides the oscilloscope instrument. Real GPIO snapshots are available in Results.</p></div>}</dialog>
          <section className="hw-dock" data-open={consoleOpen} style={{ '--hw-dock': `${layout.dock}px` } as CSSProperties}>{consoleOpen && <div className="hw-resizer hw-resizer-row" data-active={resizing === 'dock'} role="separator" aria-orientation="horizontal" aria-label="Resize console height" onPointerDown={startResize('dock')} />}<nav aria-label="Output panels">{(['compiler', 'serial', 'results', 'tools'] as const).map(value => <button key={value} aria-expanded={consoleOpen && dock === value} className={consoleOpen && dock === value ? 'active' : ''} onClick={() => { setDock(value); setConsoleOpen(true) }}>{value === 'serial' ? <Terminal size={13} /> : value === 'compiler' ? <Wrench size={13} /> : value === 'results' ? <Zap size={13} /> : <Cpu size={13} />}{value === 'compiler' ? 'Compiler' : value === 'serial' ? 'Serial monitor' : value === 'results' ? 'Results' : 'Tools'}</button>)}<span className="hw-dock-status">{busy && <LoaderCircle size={12} className="hw-spin" />}{busy || compiler?.status?.replaceAll('_', ' ') || 'Not compiled'}</span><button className="hw-console-collapse" aria-label={consoleOpen ? 'Collapse console' : 'Expand console'} aria-expanded={consoleOpen} onClick={() => setConsoleOpen(!consoleOpen)}><ChevronDown size={14} /></button></nav>
            {consoleOpen && dock === 'compiler' && <div className="hw-dock-body"><div className="hw-output-actions"><button disabled={!!busy} onClick={() => void perform('Reading compiler errors', async () => { setCompiler(await command('read_compiler_errors') as CompilerResult) })}><RefreshCw size={12} /> Read diagnostics</button>{compiler?.artifact?.url && <a href={compiler.artifact.url} download>Download HEX</a>}</div><pre>{compiler ? [compiler.stdout, compiler.stderr, ...(compiler.errors ?? []).map(value => typeof value === 'string' ? value : JSON.stringify(value))].filter(Boolean).join('\n') || compiler.status : 'Ready when you are. Compile your sketch to create real Arduino firmware.\nCompilation does not start the simulator.'}</pre></div>}
            {consoleOpen && dock === 'serial' && <div className="hw-dock-body"><pre aria-label="Serial output">{results?.serial || 'No serial output yet. Your sketch must call Serial.begin() and Serial.print().'}</pre><form className="hw-serial-send" onSubmit={event => { event.preventDefault(); try { runtime?.sendSerial(serialInput + '\n'); setSerialInput('') } catch (error) { setError((error as Error).message) } }}><input aria-label="Serial input" value={serialInput} placeholder="Send to UART…" onChange={event => setSerialInput(event.target.value)} /><button disabled={!results?.running || !serialInput}>Send</button></form></div>}
            {consoleOpen && dock === 'results' && <div className="hw-dock-body"><div className="hw-output-actions"><button disabled={!!busy || connection !== 'Connected'} onClick={() => void perform('Reading simulation results', async () => { const value = await command('read_simulation_results') as { result: RuntimeResults }; if (value.result) setResults(value.result) })}><RefreshCw size={12} /> Read runtime</button><span>{results?.cycles.toLocaleString() ?? '0'} cycles · {(results?.simulated_ms ?? 0).toFixed(1)} ms simulated</span></div><div className="hw-pin-results">{Object.entries(results?.pins ?? {}).map(([pin, value]) => <span key={pin} data-level={value.level === true ? 'high' : value.level === false ? 'low' : 'floating'}>{pin}<b>{value.level === null ? '—' : value.level ? 'HIGH' : 'LOW'}</b></span>)}</div><p className="hw-runtime-limit">Real Velxio AVR CPU / UART / GPIO. LED continuity and rail-connected buttons are supported; other parts are placement-only. No analog-current measurements are claimed.</p></div>}
            {consoleOpen && dock === 'tools' && <div className="hw-dock-body"><div className="hw-manual-tools"><button disabled={!!busy} onClick={() => void perform('Reading project', async () => { const value = await command('read_project'); setToolOutput(JSON.stringify(value, null, 2)) })}>Read project</button><button disabled={!!busy} onClick={() => void perform('Reading firmware', async () => { const value = await command('read_firmware') as Firmware; setToolOutput(JSON.stringify(value, null, 2)) })}>Read firmware</button><button disabled={!!busy || !!results?.running} onClick={() => void perform('Generating firmware', async () => { const current = projectRef.current!; const next = await hardwareApi.command<HardwareProject>(current, 'generate_firmware', { source: sourceRef.current, expected_revision: dirty ? draftRevision.current ?? current.revision : current.revision }); acceptProject(next, true); setNotice('Current editor source stored through generate_firmware.') })}>Generate from editor</button><button disabled={!!busy} onClick={() => void perform('Searching components', async () => { const value = await command('search_components', { query, limit: 50 }); setToolOutput(JSON.stringify(value, null, 2)) })}>Search catalog</button></div><form className="hw-calculator" onSubmit={event => { event.preventDefault(); void perform('Calculating', async () => { const value = await command('calculator', { expression }); setToolOutput(JSON.stringify(value, null, 2)) }) }}><input aria-label="Calculator expression" value={expression} onChange={event => setExpression(event.target.value)} placeholder="(5 - 2) / 0.02" /><button disabled={!!busy || !expression}>Calculate</button></form><pre aria-label="Tool result">{toolOutput || 'All manual tools use the same canonical backend service as the agent.'}</pre></div>}
          </section>
        </section>
        <aside className="hw-agent-panel">{!agent && <div className="hw-panel-heading"><Zap size={15} /> WireUp agent</div>}{agent ?? <div className="hw-agent-empty"><div className="hw-agent-symbol"><Zap size={24} /></div><h2>A collaborator for your circuit.</h2><p>Ask the project agent to add parts, write firmware, and inspect the real compiler and simulator.</p><div className="hw-agent-context"><Cpu size={14} /> {project.name}<small>Canonical project · revision {project.revision}</small></div><p className="hw-muted">The agent panel is supplied by the host application. Manual tools remain available below the editor.</p></div>}</aside>
      </div>
      <footer className="hw-statusbar"><span className={connection === 'Connected' ? 'hw-connected' : ''}><i />Runtime: {connection}</span>{connection !== 'Connected' && <button onClick={() => setSession(value => value + 1)} disabled={!!busy}>Reconnect</button>}<span>Project r{project.revision}</span><span>{dirty ? 'Editor has unsaved changes' : 'Server saved'}</span><span className="hw-status-engine">Velxio · AVR8 · Open source</span></footer>
    </>}
  </main>
}
