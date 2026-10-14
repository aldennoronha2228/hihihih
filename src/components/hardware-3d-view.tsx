import { Component, Suspense, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import { CubicBezierCurve3, TubeGeometry, Vector3 } from 'three'
import { Box, Check, CircleAlert, Layers3 } from 'lucide-react'
import type { CatalogComponent, HardwareComponent, HardwarePin, HardwareProject, HardwareWire } from '../lib/hardware'
import { hardwareCanvasToScene, hardwareComponentCenter, hardwarePinPosition } from '../lib/hardware-layout'
import type { ComponentSize } from '../lib/hardware-layout'
import './hardware-3d-view.css'
import { RobotCarConceptAssembly } from './robot-car-concept-assembly'

type ModelVariant = { id: string; name: string; src: string }
const CONCEPT_PART_TYPES = new Set(['arduino-uno', 'hc-sr04', 'motor-driver-l293d', 'battery-aa'])
type Hardware3DViewProps = {
  project: HardwareProject
  catalog: CatalogComponent[]
  pins: Record<string, HardwarePin[]>
  partSizes: Record<string, ComponentSize>
  selected?: string
  onSelect?: (id: string) => void
  conceptAssembly?: string
}

function validModelPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/models/3d/') && path.toLowerCase().endsWith('.glb')
}

function readModelVariants(models: Record<string, unknown>): Record<string, ModelVariant[]> {
  const result: Record<string, ModelVariant[]> = {}
  for (const [componentType, entry] of Object.entries(models)) {
    const variants = typeof entry === 'string'
      ? [{ id: componentType, name: `${componentType}.glb`, src: entry }]
      : Array.isArray(entry) ? entry : []
    result[componentType] = variants.flatMap((variant, index) => {
      if (!variant || typeof variant !== 'object' || !('src' in variant) || !validModelPath(variant.src)) return []
      const id = 'id' in variant && typeof variant.id === 'string' ? variant.id : `${componentType}-${index + 1}`
      const name = 'name' in variant && typeof variant.name === 'string' ? variant.name : `${componentType}-${index + 1}.glb`
      return [{ id, name, src: variant.src }]
    })
  }
  return result
}

function CadModel({ src }: { src: string }) {
  const { scene } = useGLTF(src)
  const instance = useMemo(() => scene.clone(true), [scene])
  return <primitive object={instance} dispose={null} />
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function PartModel({ part, size, model, selected, onSelect }: {
  part: HardwareComponent; size?: ComponentSize; model: ModelVariant; selected: boolean; onSelect: () => void
}) {
  const center = hardwareComponentCenter(part, size)
  const position = hardwareCanvasToScene(center)
  return <group position={[position.x, 0, position.z]} rotation={[0, -part.rotation * Math.PI / 180, 0]} onClick={event => { event.stopPropagation(); onSelect() }}>
    <ModelBoundary fallback={<Html center><span className="hw-3d-model-error">GLB failed to load · {model.name}</span></Html>}>
      <Suspense fallback={<Html center><span className="hw-3d-model-loading">Loading {model.name}…</span></Html>}><CadModel src={model.src} /></Suspense>
    </ModelBoundary>
    {selected && <Html position={[0, .08, 0]} center><span className="hw-3d-selection">{part.id}</span></Html>}
  </group>
}

function WireTube({ wire, a, b }: { wire: HardwareWire; a: { x: number; z: number }; b: { x: number; z: number } }) {
  const geometry = useMemo(() => {
    const start = new Vector3(a.x, .035, a.z)
    const end = new Vector3(b.x, .035, b.z)
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz) || 1
    const normalX = -dz / length
    const normalZ = dx / length
    const routeHash = [...wire.id].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    const routeOffset = ((routeHash % 7) - 3) * .008
    const control1 = new Vector3(start.x + dx / 3 + normalX * routeOffset, .035, start.z + dz / 3 + normalZ * routeOffset)
    const control2 = new Vector3(start.x + dx * 2 / 3 + normalX * routeOffset, .035, start.z + dz * 2 / 3 + normalZ * routeOffset)
    return new TubeGeometry(new CubicBezierCurve3(start, control1, control2, end), Math.max(12, Math.ceil(length * 24)), .0018, 5, false)
  }, [a.x, a.z, b.x, b.z, wire.id])
  return <mesh geometry={geometry}><meshStandardMaterial color={wire.color} roughness={.55} metalness={.12} emissive={wire.color} emissiveIntensity={.08} /></mesh>
}

function WireLine({ wire, project, pins }: { wire: HardwareWire; project: HardwareProject; pins: Record<string, HardwarePin[]> }) {
  const from = hardwarePinPosition(project, pins, wire.from)
  const to = hardwarePinPosition(project, pins, wire.to)
  if (!from || !to) return null
  const a = hardwareCanvasToScene(from)
  const b = hardwareCanvasToScene(to)
  return <WireTube wire={wire} a={a} b={b} />
}

export function Hardware3DView({ project, catalog, pins, partSizes, selected, onSelect, conceptAssembly }: Hardware3DViewProps) {
  const [manifestModels, setManifestModels] = useState<Record<string, ModelVariant[]>>({})
  const [manifestState, setManifestState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [manifestError, setManifestError] = useState('')
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({})
  const showRobotCar = conceptAssembly === 'robot-car-obstacle-avoider'

  useEffect(() => {
    if (showRobotCar) { setManifestState('ready'); return }
    let active = true
    void fetch('/models/3d/manifest.json', { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error(`Model manifest returned ${response.status}.`)
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('models' in value) || !value.models || typeof value.models !== 'object') {
        throw new Error('The model manifest must include a models map.')
      }
      const variants = readModelVariants(value.models as Record<string, unknown>)
      if (active) { setManifestModels(variants); setManifestState('ready') }
    }).catch(error => {
      if (active) { setManifestError(error instanceof Error ? error.message : 'Could not read the model manifest.'); setManifestState('error') }
    })
    return () => { active = false }
  }, [showRobotCar])

  useEffect(() => {
    try {
      const value = localStorage.getItem(`wireup:3d-model-selection:${project.id}`)
      setChosenVariants(value ? JSON.parse(value) as Record<string, string> : {})
    } catch { setChosenVariants({}) }
  }, [project.id])

  const names = useMemo(() => new Map(catalog.map(item => [item.type ?? item.id ?? '', item.name])), [catalog])
  const modelForPart = (part: HardwareComponent) => {
    const variants = manifestModels[part.type] ?? []
    return variants.find(variant => variant.id === chosenVariants[part.id]) ?? variants[0]
  }
  const modeledIds = useMemo(() => new Set(project.components.filter(part => !!modelForPart(part)).map(part => part.id)), [chosenVariants, manifestModels, project.components])
  const modeledCount = modeledIds.size
  const unresolvedWires = project.wires.filter(wire => !hardwarePinPosition(project, pins, wire.from) || !hardwarePinPosition(project, pins, wire.to)).length
  const sceneFrame = useMemo(() => {
    const positions = project.components.filter(part => modeledIds.has(part.id)).map(part => hardwareCanvasToScene(hardwareComponentCenter(part, partSizes[part.id])))
    if (!positions.length) return { focus: [0, 0, 0] as [number, number, number], radius: .5 }
    const xs = positions.map(point => point.x)
    const zs = positions.map(point => point.z)
    const focus: [number, number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2]
    return { focus, radius: Math.max(.4, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) }
  }, [modeledIds, partSizes, project.components])

  const chooseVariant = (componentId: string, variantId: string) => {
    const next = { ...chosenVariants, [componentId]: variantId }
    setChosenVariants(next)
    try { localStorage.setItem(`wireup:3d-model-selection:${project.id}`, JSON.stringify(next)) } catch { /* Selection still applies for this session. */ }
  }

  return <div className="hw-3d-view">
    <header className="hw-3d-toolbar">
      <div className="hw-3d-title"><span className="hw-3d-kicker">WIREUP · 3D VIEW</span><strong>{project.name}</strong></div>
      <div className="hw-3d-flow" aria-label="Design stages"><span className="is-done">Idea</span><i /><span className={project.components.length ? 'is-done' : ''}><Layers3 size={11} /> Electronics</span><i /><span className={showRobotCar || modeledCount ? 'is-active' : ''}><Box size={11} /> {showRobotCar ? '3D concept' : '3D models'}</span></div>
      <div className="hw-3d-totals"><strong>{showRobotCar ? '1' : modeledCount}<small>{showRobotCar ? '' : ` / ${project.components.length}`}</small></strong><span>{showRobotCar ? 'concept assembly' : 'models found'}</span></div>
    </header>

    <div className="hw-3d-workspace">
      <aside className="hw-3d-library" aria-label="WireUp project components">
        <div className="hw-3d-library-heading"><div><span>PROJECT PARTS</span><strong>{showRobotCar ? 'Vehicle assembly' : 'Electronics'}</strong></div><span className="hw-3d-count">{project.components.length + (showRobotCar ? 4 : 0)}</span></div>
        <div className="hw-3d-part-list">
          {project.components.map(part => {
            const variants = manifestModels[part.type] ?? []
            const activeModel = modelForPart(part)
            const title = names.get(part.type) ?? part.type.replaceAll('-', ' ')
            return <article key={part.id} className={`hw-3d-part-card${selected === part.id ? ' is-selected' : ''}`}>
              <button className="hw-3d-part-select" onClick={() => onSelect?.(part.id)} aria-pressed={selected === part.id}>
                <span className={`hw-3d-part-dot${activeModel ? ' has-model' : ''}`} />
                <span className="hw-3d-part-copy"><strong>{title}</strong><small>{part.id} · {activeModel?.name ?? (showRobotCar && CONCEPT_PART_TYPES.has(part.type) ? 'Concept geometry in assembly' : 'No model asset')}</small></span>
                {activeModel ? <Check size={14} className="hw-3d-ready-icon" /> : showRobotCar && CONCEPT_PART_TYPES.has(part.type) ? <Box size={13} className="hw-3d-concept-icon" /> : <CircleAlert size={14} className="hw-3d-missing-icon" />}
              </button>
              {variants.length > 1 && <label className="hw-3d-variant"><span>Model</span><span className="hw-3d-select-wrap"><select value={activeModel?.id ?? ''} onChange={event => chooseVariant(part.id, event.currentTarget.value)} aria-label={`3D model for ${title}`}>
                {variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
              </select></span></label>}
            </article>
          })}
          {!project.components.length && <div className="hw-3d-empty-list">Add electronic components in WireUp to see the assembly.</div>}
          {showRobotCar && <section className="hw-3d-mechanical-list" aria-label="Mechanical concept parts"><span>MECHANICAL CONCEPT</span>
            <article><strong>100:1 LP 6V gearmotor ×2</strong><small>Pololu #992 · sourced envelope</small></article>
            <article><strong>70 × 8 mm wheels ×2</strong><small>Pololu #1425 · 3 mm D-shaft fit</small></article>
            <article><strong>3/8 in ball caster</strong><small>Pololu #951 · 9.525 mm ball</small></article>
            <article><strong>Chassis and AA holder</strong><small>Custom concept · fit not verified</small></article>
          </section>}
        </div>
        <div className="hw-3d-library-note"><strong>{showRobotCar ? 'Concept assembly' : 'Published 3D assets'}</strong><span>{showRobotCar ? 'A dimensioned product concept based on the selected parts. Simplified surfaces are labeled; this view does not claim manufacturer CAD or motion simulation.' : 'This view displays the published 3D assets for the selected project parts.'}</span></div>
      </aside>

      <main className="hw-3d-canvas-panel">
        <div className="hw-3d-canvas-caption"><span><Box size={13} /> 3D ASSEMBLY</span><span>Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Right-drag to pan</span></div>
        {manifestState === 'error' && !showRobotCar && <div className="hw-3d-message is-error" role="alert">{manifestError}</div>}
        {unresolvedWires > 0 && !showRobotCar && <div className="hw-3d-message" role="status">{unresolvedWires} connection(s) are hidden until WireUp pin metadata resolves.</div>}
        <div className="hw-3d-stage">
          {manifestState === 'loading' && !showRobotCar && <div className="hw-3d-loading">Reading 3D model manifest…</div>}
          {manifestState === 'ready' && modeledCount === 0 && !showRobotCar && <div className="hw-3d-empty-state">
            <div className="hw-3d-empty-icon"><Box size={24} /></div><span className="hw-3d-empty-eyebrow">WAITING FOR MODEL ASSETS</span>
            <h2>No model assets published yet</h2>
            <p>Publish a dimensioned model asset for selected parts to make them visible here.</p>
            <span className="hw-3d-empty-count">{project.components.length} WireUp parts · {project.wires.length} connections · no proxy geometry</span>
          </div>}
          <Canvas camera={{ position: showRobotCar ? [.24, .19, .28] : [sceneFrame.focus[0] + sceneFrame.radius * .72, sceneFrame.radius * .7, sceneFrame.focus[2] + sceneFrame.radius * .8], fov: showRobotCar ? 38 : 42, near: .01, far: 30 }} dpr={[1, 2]} gl={{ antialias: true }} shadows>
            <color attach="background" args={['#10151d']} />
            <ambientLight intensity={1.15} />
            <directionalLight position={[1.4, 2.2, 1.2]} intensity={2.1} castShadow />
            <gridHelper args={showRobotCar ? [.32, 32, '#40536a', '#273342'] : [2, 40, '#40536a', '#273342']} position={[0, showRobotCar ? -.001 : -.018, 0]} />
            {showRobotCar && <RobotCarConceptAssembly />}
            {!showRobotCar && project.wires.map(wire => modeledIds.has(wire.from.component) && modeledIds.has(wire.to.component)
              ? <WireLine key={wire.id} wire={wire} project={project} pins={pins} /> : null)}
            {!showRobotCar && project.components.map(part => {
              const model = modelForPart(part)
              return model ? <PartModel key={part.id} part={part} size={partSizes[part.id]} model={model} selected={selected === part.id} onSelect={() => onSelect?.(part.id)} /> : null
            })}
            <OrbitControls makeDefault target={showRobotCar ? [0, .025, 0] : sceneFrame.focus} minDistance={showRobotCar ? .12 : .3} maxDistance={8} enableDamping dampingFactor={.08} />
          </Canvas>
          {showRobotCar && <div className="hw-3d-concept-badge"><strong>ROBOT CAR · CUSTOM CONCEPT MODEL</strong><span>160 × 100 × 3 mm chassis envelope · differential drive · front ultrasonic sensor</span><span>Orbit to inspect · scroll to zoom</span></div>}
          {manifestState === 'ready' && modeledCount > 0 && modeledCount < project.components.length && !showRobotCar && <div className="hw-3d-stage-status">{project.components.length - modeledCount} parts have no published model</div>}
        </div>
        <footer className="hw-3d-footnote">{showRobotCar ? 'Wheel, sensor, board, and motor envelopes use the project’s sourced dimensions. Mounts, battery holder, chassis fit, wire paths, and small surface details are custom concept geometry. Vehicle dynamics are not simulated.' : 'Component placement and wire endpoints follow WireUp’s 2D layout and live pin metadata. This 3D view does not simulate physics.'}</footer>
      </main>
    </div>
  </div>
}

export default Hardware3DView
