import { SiriWave } from './siri-wave'
import './workspace-loading.css'

export function WorkspaceLoading() {
  return <section className="workspace-loading" role="status" aria-label="Loading workspace"><div className="workspace-loading-wave" aria-hidden="true"><SiriWave variant="wave" size={320} renderScale={0.75}/></div><h2>Opening your workspace</h2><p>Loading the project, component library, and circuit view.</p></section>
}
