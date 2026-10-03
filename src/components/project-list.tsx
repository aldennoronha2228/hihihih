import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, Cpu, Trash2 } from 'lucide-react'
import { hardwareApi } from '@/lib/hardware'
import type { HardwareProjectSummary } from '@/lib/hardware'

export function ProjectList({ projects, onDeleted, limit }: { projects: HardwareProjectSummary[]; onDeleted: (ids: string[]) => void; limit?: number }) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sorted = [...projects].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id.localeCompare(a.id))
  const visible = limit ? sorted.slice(0, limit) : sorted
  const remove = async () => {
    setBusy(true); setError('')
    const deleted: string[] = []
    const failed: string[] = []
    for (const id of selected) {
      try {
        await hardwareApi.deleteProject(id)
        deleted.push(id)
        try { localStorage.removeItem(`wireup.project.${id}.chats.v1`) } catch { /* Server deletion is authoritative. */ }
      } catch (error) { failed.push(`${projects.find(project => project.id === id)?.name || id}: ${error instanceof Error ? error.message : 'Deletion failed.'}`) }
    }
    onDeleted(deleted)
    setSelected(previous => previous.filter(id => !deleted.includes(id)))
    setError(failed.join('\n'))
    setBusy(false); setConfirming(false)
    if (!failed.length) setSelecting(false)
  }
  return <section aria-label="Project list">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium text-neutral-300">{limit ? 'Recent prototypes' : 'All projects'} <span className="ml-2 text-neutral-500">{limit ? Math.min(projects.length, limit) : projects.length}</span></h2><div className="flex flex-wrap items-center gap-2">
      {selecting && <><button disabled={busy || !visible.length} onClick={() => setSelected(visible.map(project => project.id))} className="rounded-lg border border-neutral-700 px-3 py-2 text-xs">Select all{limit ? ' shown' : ''}</button><button disabled={busy || !selected.length} onClick={() => setConfirming(true)} className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300 disabled:opacity-40"><Trash2 size={14} />Delete selected ({selected.length})</button></>}
      <button disabled={busy} onClick={() => { setSelecting(!selecting); setSelected([]); setError('') }} className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300"><CheckSquare size={14} />{selecting ? 'Cancel selection' : 'Select projects'}</button>
      {limit && <Link to="/projects" className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">All projects ({projects.length})</Link>}
    </div></div>
    {error && <p role="alert" className="mb-4 whitespace-pre-wrap rounded-lg border border-red-400/20 bg-neutral-900 p-3 text-xs leading-5 text-red-300">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(project => <div key={project.id} className={`relative rounded-xl border bg-neutral-900/95 ${selected.includes(project.id) ? 'border-neutral-500' : 'border-neutral-800 hover:border-neutral-600'}`}>
      {selecting ? <label className="flex cursor-pointer items-start gap-3 p-5"><input type="checkbox" aria-label={`Select ${project.name}`} checked={selected.includes(project.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, project.id] : previous.filter(id => id !== project.id))} className="mt-1 accent-neutral-300" /><ProjectCard project={project} /></label> : <Link to={`/project/${project.id}`} className="block p-5"><ProjectCard project={project} /></Link>}
    </div>)}</div>
    {!projects.length && <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-sm text-neutral-500">No saved projects. Create a new prototype from the home page.</p>}
    {confirming && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div role="dialog" aria-modal="true" aria-labelledby="delete-project-title" className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6"><h3 id="delete-project-title" className="text-lg font-medium text-white">Delete {selected.length} project{selected.length === 1 ? '' : 's'}?</h3><p className="mt-3 text-sm leading-6 text-neutral-400">This permanently deletes the selected circuits, firmware, compilation artifacts, and this browser’s project chat history. This cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button autoFocus disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={() => void remove()} className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete projects'}</button></div></div></div>}
  </section>
}
function ProjectCard({ project }: { project: HardwareProjectSummary }) {
  return <div className="min-w-0 flex-1"><Cpu size={22} className="mb-4 text-neutral-400" /><h3 className="truncate text-sm font-medium text-neutral-100">{project.name}</h3><p className="mt-2 text-xs text-neutral-500">{project.board} · revision {project.revision}</p></div>
}
