import { useMemo, useState } from 'react'
import { Activity, CircleCheck, Code2, Crosshair, Download, FileText, Gauge, LayoutGrid, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import type { CatalogComponent, HardwareProject, WireEndpoint } from '../lib/hardware'
import { catalogPins } from '../lib/hardware'
import type { HardwareRuntime, RuntimeResults } from '../hardware/runtime'
import { sourceCatalog } from '../hardware/spice'
import type { AnalogSolveResult } from '../hardware/spice'
import { SchematicCanvas, SchematicSymbolPreview } from './schematic-canvas'
import { HardwareInstruments } from './hardware-instruments'
import { analyzeSchematic, buildBomCsv, downloadText } from '../lib/schematic'
import './schematic-studio.css'

export type SchematicStudioProps = {
  project: HardwareProject
  catalog: CatalogComponent[]
  analog: AnalogSolveResult | null
  solving: boolean
  onSolve: (analysis: 'dc' | 'transient') => void
  onMove: (id: string, x: number, y: number) => Promise<void>
  onAddComponent: (type: string) => Promise<void>
  onTune: (id: string, properties: Record<string, unknown>) => Promise<void>
  onUndo: () => Promise<void>
  onReload: () => void
  selectedId?: string | null
  onSelect?: (id: string) => void
  onConnect?: (from: WireEndpoint, to: WireEndpoint) => void
  runtime: HardwareRuntime | null
  results: RuntimeResults | null
  busy?: string
  solveError?: string
}

type DockTab = 'scope' | 'analysis' | 'tuning' | 'rules' | 'serial'

const categoryNames: Record<string, string> = {
  boards: 'Microcontrollers', sensors: 'Sensors', displays: 'Displays', input: 'Inputs', output: 'Outputs',
  passive: 'Passives', analog: 'Analog', motors: 'Motors', communication: 'Communication', logic: 'Logic', other: 'Other components',
}
const categoryOrder = ['analog', 'passive', 'boards', 'input', 'output', 'sensors', 'displays', 'motors', 'communication', 'logic', 'other']

function tuneFields(type: string): string[] {
  if (/resistor|capacitor|inductor/.test(type)) return ['value']
  if (/current/.test(type)) return ['current']
  if (/sine/.test(type)) return ['amplitude', 'frequency']
  if (/pulse/.test(type)) return ['low', 'high', 'period']
  if (/voltage/.test(type)) return ['voltage']
  return []
}

export function SchematicStudio({ project, catalog, analog, solving, onSolve, onMove, onAddComponent, onTune, onUndo, onReload, selectedId, onSelect, onConnect, runtime, results, busy, solveError }: SchematicStudioProps) {
  const [libraryTab, setLibraryTab] = useState<'curated' | 'library'>('library')
  const [query, setQuery] = useState('')
  const [probeMode, setProbeMode] = useState(false)
  const [probe, setProbe] = useState<WireEndpoint | null>(null)
  const [biasOn, setBiasOn] = useState(true)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [dockTab, setDockTab] = useState<DockTab>('scope')
  const [arranging, setArranging] = useState(false)
  const [tuning, setTuning] = useState<Record<string, Record<string, string>>>({})

  const analysis = useMemo(() => analyzeSchematic(project, catalog), [project, catalog])
  const errors = analysis.issues.filter(issue => issue.severity === 'error').length
  const warnings = analysis.issues.filter(issue => issue.severity === 'warning').length
  const biasFresh = !!analog?.ok && analog.analysis === 'dc' && analog.projectRevision === project.revision
  const stale = !!analog && analog.projectRevision !== project.revision
  const channelCount = Object.keys(results?.pins ?? {}).length
  const solvingNow = solving || !!busy

  const openDock = (tab: DockTab) => { setDockTab(tab); setScopeOpen(true) }
  const toggleBias = () => {
    const next = !biasOn
    setBiasOn(next)
    if (next && (!analog || stale || analog.analysis !== 'dc')) void onSolve('dc')
  }
  const autoArrange = async () => {
    if (arranging) return
    setArranging(true)
    try {
      const cols = Math.max(1, Math.ceil(Math.sqrt(project.components.length)))
      for (const [index, component] of project.components.entries()) {
        const x = 420 + (index % cols) * 300, y = 140 + Math.floor(index / cols) * 230
        if (component.x !== x || component.y !== y) await onMove(component.id, x, y)
      }
    } finally { setArranging(false) }
  }
  const exportBom = () => downloadText(`${project.name.slice(0, 40) || 'schematic'}-bom.csv`, buildBomCsv(project, catalog))
  const libraryGroups = useMemo(() => {
    const items = catalog.filter(item => `${item.name} ${item.type}`.toLowerCase().includes(query.toLowerCase()))
    const groups = new Map<string, CatalogComponent[]>()
    for (const item of items) {
      const category = item.category ?? 'other'
      if (!groups.has(category)) groups.set(category, [])
      groups.get(category)!.push(item)
    }
    return [...groups.entries()].sort((a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]))
  }, [catalog, query])
  const curatedParts = project.components.filter(component => `${component.id} ${component.type}`.toLowerCase().includes(query.toLowerCase()))

  return <div className="schematic-studio">
    <div className="schematic-toolbar">
      <strong className="schematic-project-name">{project.name}</strong>
      <div className="schematic-toolbar-actions">
        <button onClick={() => void autoArrange()} disabled={solvingNow || arranging || !project.components.length}>{arranging ? <LoaderCircle size={13} className="schematic-spin" /> : <LayoutGrid size={13} />} Auto-arrange</button>
        <button className={errors ? 'is-bad' : warnings ? 'is-warn' : 'is-good'} onClick={() => openDock('rules')} title={errors || warnings ? `${errors} errors · ${warnings} warnings` : 'No electrical rule issues'}>
          {errors ? <TriangleAlert size={13} /> : <CircleCheck size={13} />} ERC · {errors ? `${errors} issue${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warn` : 'OK'}
        </button>
        <button aria-pressed={probeMode} className={probeMode ? 'is-active' : ''} onClick={() => { setProbeMode(value => !value); setProbe(null) }} title="Click a pin or wire to read its bias voltage"><Crosshair size={13} /> Probe</button>
        <button aria-pressed={biasOn} className={biasOn ? 'is-active' : ''} onClick={toggleBias} title="DC operating point from ngspice"><Gauge size={13} /> Bias</button>
        <button onClick={() => openDock('rules')}><FileText size={13} /> Report</button>
        <button onClick={() => openDock('scope')}><Activity size={13} /> Oscilloscope</button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('wireup:open-sketch'))} title="Edit firmware"><Code2 size={13} /> Sketch</button>
      </div>
    </div>
    {solveError && <div className="schematic-solve-error" role="alert">{solveError}<button onClick={() => void onSolve('dc')} aria-label="Retry analog solve">Retry</button></div>}
    <div className="schematic-columns">
      <aside className="schematic-library" aria-label="Symbol library">
        <div className="schematic-library-head">
          <strong>Components</strong><span className="schematic-library-count">{libraryTab === 'library' ? catalog.length : project.components.length}</span>
        </div>
        <div className="schematic-library-tabs" role="tablist" aria-label="Library source">
          {(['curated', 'library'] as const).map(tab => <button key={tab} role="tab" aria-selected={libraryTab === tab} className={libraryTab === tab ? 'active' : ''} onClick={() => setLibraryTab(tab)}>{tab === 'curated' ? 'Curated' : 'Library'}</button>)}
        </div>
        <label className="schematic-library-search"><input aria-label="Search symbols" placeholder="Search symbols…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="schematic-library-list">
          {libraryTab === 'library' ? libraryGroups.map(([category, items]) => <details key={category} className="schematic-library-group" open>
            <summary>{categoryNames[category] ?? category}<span>{items.length}</span></summary>
            {items.map(item => <button key={item.type ?? item.id} className="schematic-library-item" disabled={solvingNow} title={item.description ?? item.name} onClick={() => void onAddComponent(String(item.type ?? item.id))}>
              <SchematicSymbolPreview type={String(item.type ?? item.id)} name={item.name} pins={catalogPins(item)} />
              <span className="schematic-library-name">{item.name}</span>
              <small>{catalogPins(item).length ? `${catalogPins(item).length} pins` : 'symbol'}</small>
            </button>)}
          </details>) : curatedParts.length ? curatedParts.map(component => <button key={component.id} className={`schematic-library-item is-part${selectedId === component.id ? ' is-selected' : ''}`} onClick={() => onSelect?.(component.id)}>
            <SchematicSymbolPreview type={component.type} name={component.type} />
            <span className="schematic-library-name">{component.id}</span>
            <small>{component.type}</small>
          </button>) : <p className="schematic-library-empty">Nothing in this circuit yet. Place parts from the Library tab.</p>}
        </div>
      </aside>
      <div className="schematic-main">
        <div className="schematic-canvas-row">
          <SchematicCanvas project={project} catalog={catalog} selectedId={selectedId} result={analog} showVoltages={biasOn}
            probeMode={probeMode} probe={probe} onProbe={setProbe}
            onSelect={onSelect} onMove={onMove} onConnect={onConnect}
            onUndo={() => void onUndo()} onReload={onReload} />
          <aside className="schematic-sheet" aria-label="Sheet information">
            <h3>Sheet</h3>
            <div className="schematic-sheet-stats">
              <span><b>{project.components.length}</b> parts</span>
              <span><b>{analysis.nets.length}</b> nets</span>
            </div>
            <div className="schematic-sheet-links">
              <button onClick={exportBom} disabled={!project.components.length}><Download size={12} /> BOM CSV</button>
              <button onClick={() => openDock('rules')}><FileText size={12} /> Report</button>
            </div>
            <p className="schematic-sheet-note">{errors ? `${errors} ERC error${errors > 1 ? 's' : ''} need attention.` : biasFresh ? `ngspice DC bias solved in ${analog.solveMs.toFixed(0)} ms.` : 'Run Bias for real DC voltages.'}</p>
          </aside>
        </div>
        {scopeOpen && <section className="schematic-dock" aria-label="Instruments">
          <nav className="schematic-dock-tabs" role="tablist" aria-label="Instrument panels">
            {(['scope', 'analysis', 'tuning', 'rules', 'serial'] as const).map(tab => <button key={tab} role="tab" aria-selected={dockTab === tab} className={dockTab === tab ? 'active' : ''} onClick={() => setDockTab(tab)}>
              {tab === 'scope' ? `Scope${channelCount ? ` · ${channelCount}` : ''}` : tab[0].toUpperCase() + tab.slice(1)}
              {tab === 'rules' && errors > 0 && <em>{errors}</em>}
            </button>)}
            <button className="schematic-dock-close" aria-label="Close instruments" onClick={() => setScopeOpen(false)}><X size={14} /></button>
          </nav>
          <div className="schematic-dock-body" role="tabpanel">
            {dockTab === 'scope' && <div className="schematic-dock-instrument"><HardwareInstruments runtime={runtime} results={results} analogResult={biasOn && analog?.ok ? analog : null} /></div>}
            {dockTab === 'analysis' && <div className="schematic-dock-pane">
              <div className="schematic-dock-actions">
                <button disabled={solvingNow || !project.components.length} onClick={() => void onSolve('dc')}>{solving ? <LoaderCircle size={12} className="schematic-spin" /> : <Gauge size={12} />} Run DC bias</button>
                <button disabled={solvingNow || !project.components.length} onClick={() => void onSolve('transient')}><Activity size={12} /> Run transient</button>
                {analog && <span className="schematic-dock-meta">ngspice {analog.analysis} · {analog.solveMs.toFixed(0)} ms · project r{analog.projectRevision}{stale ? ' (stale — re-run)' : ''}</span>}
              </div>
              {analog?.ok && !!Object.keys(analog.nodeVoltages).length && <table className="schematic-analysis-table">
                <thead><tr><th>Net</th><th>Voltage</th></tr></thead>
                <tbody>{Object.entries(analog.nodeVoltages).map(([net, values]) => <tr key={net}><td>{net}</td><td>{values.at(-1)?.toPrecision(4) ?? '—'} V</td></tr>)}</tbody>
              </table>}
              {analog && !analog.ok && analog.diagnostics.map((diagnostic, index) => <p key={index} className={`schematic-diag is-${diagnostic.severity}`}>{diagnostic.message}</p>)}
              {!analog && <p className="schematic-dock-empty">No analysis yet. Run DC bias to compute the real operating point of every net.</p>}
            </div>}
            {dockTab === 'tuning' && <div className="schematic-dock-pane">
              {project.components.filter(component => tuneFields(component.type).length).length ? project.components.filter(component => tuneFields(component.type).length).map(component => {
                const fields = tuneFields(component.type)
                const source = sourceCatalog.find(entry => entry.type === component.type)
                const current = tuning[component.id] ?? Object.fromEntries(fields.map(field => [field, String(component.properties?.[field] ?? source?.defaultValues?.[field] ?? '')]))
                return <div key={component.id} className="schematic-tune-row">
                  <b>{component.id}</b><small>{component.type}</small>
                  {fields.map(field => <label key={field}>{field}<input value={current[field] ?? ''} inputMode="decimal" onChange={event => setTuning(previous => ({ ...previous, [component.id]: { ...current, [field]: event.target.value } }))} /></label>)}
                  <button disabled={solvingNow} onClick={() => { const next: Record<string, unknown> = {}; for (const field of fields) { const parsed = Number(current[field]); next[field] = Number.isFinite(parsed) && current[field]?.trim() !== '' ? parsed : current[field] } void onTune(component.id, next) }}>Apply</button>
                </div>
              }) : <p className="schematic-dock-empty">No tunable parts. Sources, resistors, capacitors, and inductors can be adjusted here.</p>}
            </div>}
            {dockTab === 'rules' && <div className="schematic-dock-pane">
              {analysis.issues.length ? analysis.issues.map((issue, index) => <button key={index} className={`schematic-rule-row is-${issue.severity}`} onClick={() => issue.ref && onSelect?.(issue.ref)}>
                {issue.severity === 'error' ? <TriangleAlert size={12} /> : <CircleCheck size={12} />}
                <span>{issue.message}</span>
              </button>) : <p className="schematic-dock-empty">ERC passes: every wire lands on a known pin and nothing is floating.</p>}
              {!!analog?.diagnostics.length && <div className="schematic-rule-spice">{analog.diagnostics.map((diagnostic, index) => <p key={index} className={`schematic-diag is-${diagnostic.severity}`}>ngspice: {diagnostic.message}</p>)}</div>}
            </div>}
            {dockTab === 'serial' && <div className="schematic-dock-pane">
              {results?.serial ? <pre className="schematic-serial">{results.serial}</pre> : <p className="schematic-dock-empty">No serial output yet. Run compiled firmware that calls Serial.begin() and Serial.print().</p>}
            </div>}
          </div>
        </section>}
      </div>
    </div>
  </div>
}

export default SchematicStudio
