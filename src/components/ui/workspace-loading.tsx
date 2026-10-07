import { CircuitBoard } from 'lucide-react'
import './workspace-loading.css'

export function WorkspaceLoading() {
  return <section className="workspace-loading" role="status" aria-label="Loading workspace"><div className="workspace-loading-symbol" aria-hidden="true"><svg viewBox="0 0 160 160"><path d="M0 40h40v30h24M160 120h-40V90H96M40 160v-40h30V96M120 0v40H90v24"/><circle cx="40" cy="40" r="4"/><circle cx="120" cy="120" r="4"/><circle cx="40" cy="120" r="4"/><circle cx="120" cy="40" r="4"/></svg><CircuitBoard size={32}/></div><h2>Opening your workspace</h2><p>Loading the project, component library, and circuit view.</p><div className="workspace-loading-track" aria-hidden="true"><span/></div></section>
}
