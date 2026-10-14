import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { openSample } from '@/lib/open-sample'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'

type Sample = { id: string; title: string; description: string; board: string; thumbnail?: string; thumbnail_label?: string; verification?: string; simulation_ready?: boolean; compile_supported?: boolean; requirements?: unknown }
export function SampleProjects() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    fetch('/api/hardware/samples').then(async response => {
      if (!response.ok) throw new Error('Starter projects are temporarily unavailable.')
      const result = await response.json()
      if (!Array.isArray(result.samples)) throw new Error('Starter project catalog returned an invalid response.')
      if (active) setSamples(result.samples)
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const open = async (id: string) => {
    if (opening) return
    setOpening(id); setError('')
    try {
      const result = await openSample(id)
      navigate(`/project/${result.id}?sample=${encodeURIComponent(id)}`, { state: { setupGuidance: result.setup_guidance, sampleId: id } })
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open this sample.'); setOpening('') }
  }
  return <section aria-label="Starter projects" className="mt-14">
    <div className="mb-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">Start from an example</h2><Link to="/examples" className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200">View all examples</Link></div><p className="mt-2 text-sm text-neutral-400">Open a prewired circuit with firmware. Each starter creates your own editable copy.</p></div>
    {loading && <p role="status" className="text-xs text-neutral-500">Loading starter projects…</p>}
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/20 bg-neutral-900 p-3 text-sm text-red-300">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{samples.map(sample => <button key={sample.id} type="button" disabled={!!opening} onClick={() => void open(sample.id)} aria-label={`Open sample ${sample.title}`} className="group overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/95 text-left hover:border-neutral-500 disabled:opacity-60">
      {sample.thumbnail && <div className="relative bg-neutral-950"><img src={sample.thumbnail} alt="" loading="lazy" className="h-40 w-full object-contain" />{sample.thumbnail_label && <span className="absolute bottom-2 left-2 rounded-md border border-neutral-600 bg-neutral-950/90 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-300">{sample.thumbnail_label}</span>}</div>}
      <div className="p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{sample.title}</h3>{opening === sample.id ? <LoaderCircle size={16} className="shrink-0 animate-spin" /> : <ArrowUpRight size={16} className="shrink-0 text-neutral-500" />}</div><p className="mt-2 text-xs leading-5 text-neutral-400">{sample.description}</p><p className="mt-3 text-[11px] text-neutral-500">{sample.board} · {sample.simulation_ready ? 'Compile and run in browser' : sample.compile_supported ? 'Compile supported · simulation partial' : 'Physical hardware integration'}</p></div>
    </button>)}</div>
    {!loading && !error && !samples.length && <p className="text-sm text-neutral-500">No compatible starters are available yet.</p>}
  </section>
}
