import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hardwareApi } from '@/lib/hardware'
import type { HardwareProjectSummary } from '@/lib/hardware'
import { ProjectList } from './project-list'

export function AllProjects() {
  const [projects, setProjects] = useState<HardwareProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    hardwareApi.listProjects().then(result => { if (active) setProjects(result.projects) }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return <div className="dark min-h-svh bg-[#0a0a0a] text-neutral-100"><header className="flex h-20 items-center justify-between border-b border-neutral-800 px-5 sm:px-10"><Link to="/" className="flex items-center gap-3 text-xl font-semibold"><img src="/wireup-logo.png" alt="" className="size-9 rounded-lg" />WireUp</Link><Link to="/" className="rounded-lg border border-neutral-700 px-3 py-2 text-xs">Back to home</Link></header><main className="mx-auto max-w-6xl px-5 py-12"><h1 className="mb-3 text-3xl font-semibold">Your prototypes</h1><p className="mb-8 text-sm text-neutral-400">Open a project or select old projects to delete.</p>{loading ? <p role="status" className="text-sm text-neutral-400">Loading projects…</p> : error ? <p role="alert" className="text-sm text-red-300">{error}</p> : <ProjectList projects={projects} onDeleted={ids => setProjects(previous => previous.filter(project => !ids.includes(project.id)))} />}</main></div>
}
