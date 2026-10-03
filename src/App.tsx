import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { hardwareApi } from '@/lib/hardware'
import type { CatalogComponent, HardwareProject } from '@/lib/hardware'
import type { HardwareRuntime, RuntimeResults } from '@/hardware/runtime'
import type { AnalogSolveResult } from '@/hardware/spice'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ChatApp } from '@/components/chat-app'
import { AllProjects } from '@/components/all-projects'
import { PlatformHome } from '@/components/platform-home'

const Preview = lazy(() => import('@/components/demo'))
const SchematicCanvas = lazy(() => import('@/components/schematic-canvas').then(module => ({ default: module.SchematicCanvas })))
const HardwareInstruments = lazy(() => import('@/components/hardware-instruments').then(module => ({ default: module.HardwareInstruments })))
const HardwareWorkspace = lazy(() => import('@/components/hardware-workspace').then(module => ({ default: module.HardwareWorkspace })))

function ProjectPage() {
  const [project, setProject] = useState<HardwareProject | null>(null)
  const location = useLocation()
  const initialPrompt = (location.state as { initialPrompt?: string } | null)?.initialPrompt
  const onProjectChange = useCallback((next: HardwareProject | null) => setProject(next), [])
  const [runtime, setRuntime] = useState<HardwareRuntime | null>(null)
  const [results, setResults] = useState<RuntimeResults | null>(null)
  const [view, setView] = useState<'circuit' | 'schematic'>('circuit')
  const [analog, setAnalog] = useState<AnalogSolveResult | null>(null)
  const [solving, setSolving] = useState(false)
  const [solveError, setSolveError] = useState('')
  const [catalog, setCatalog] = useState<CatalogComponent[]>([])
  const [selected, setSelected] = useState<string>()
  useEffect(() => { hardwareApi.catalog('', 200).then(result => setCatalog(result.components)).catch(() => {}) }, [])
  const solve = async (analysis: 'dc' | 'transient') => {
    if (!project || solving) return
    setSolving(true); setSolveError(''); setView('schematic')
    try {
      const { solveAnalog } = await import('@/hardware/spice')
      setAnalog(await solveAnalog(project, { analysis }))
    } catch (error) { setSolveError(error instanceof Error ? error.message : 'Analog solve failed.') }
    finally { setSolving(false) }
  }
  const mutate = async (name: 'modify_component' | 'connect_wire', args: Record<string, unknown>) => {
    if (!project || results?.running) return
    await hardwareApi.command(project, name, { ...args, expected_revision: project.revision })
    setProject(await hardwareApi.getProject(project.id))
  }
  return <Suspense fallback={<div className="flex h-svh items-center justify-center bg-neutral-950 text-neutral-400">Loading hardware workspace…</div>}><HardwareWorkspace onProjectChange={onProjectChange} onRuntimeChange={setRuntime} onResultsChange={setResults} view={view} onViewChange={setView}
    analysisSlot={<><button disabled={solving || !project} onClick={() => void solve('dc')}>{solving ? 'Solving…' : 'DC Bias'}</button><button disabled={solving || !project} onClick={() => void solve('transient')}>Transient</button></>}
    schematicSlot={project ? <div className="flex h-full min-h-0 flex-col">{solveError && <p role="alert" className="p-3 text-xs text-red-300">{solveError}</p>}<SchematicCanvas project={project} catalog={catalog} selectedId={selected} onSelect={setSelected} result={analog || undefined} onMove={(id, x, y) => { void mutate('modify_component', { id, x, y }).catch(error => setSolveError(error.message)) }} onConnect={(from, to) => { void mutate('connect_wire', { from, to }).catch(error => setSolveError(error.message)) }} /></div> : null}
    oscilloscopeSlot={<HardwareInstruments runtime={runtime} results={results} analogResult={analog?.projectRevision === project?.revision ? analog : null} />}
    chatSlot={<ChatApp key={project?.id || 'none'} embedded initialPrompt={initialPrompt} projectId={project?.id} runtimeToken={project?.runtime_token} />} /></Suspense>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/orb" element={<Suspense fallback={<div className="h-svh bg-[#0a0a0a]" />}><Preview /></Suspense>} />
        <Route path="/" element={<PlatformHome />} />
        <Route path="/chat/:id" element={<ChatApp />} />
        <Route path="/projects" element={<AllProjects />} />
        <Route path="/assistant" element={<ChatApp />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="*" element={<div className="flex h-svh items-center justify-center bg-neutral-950 text-white"><a href="/">Page not found. Return to WireUp.</a></div>} />
      </Routes>
    </BrowserRouter>
  )
}
