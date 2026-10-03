export type HardwarePin = { name: string; x?: number; y?: number }
export type HardwareComponent = {
  id: string; type: string; x: number; y: number; rotation: number; properties: Record<string, unknown>
}
export type WireEndpoint = { component: string; pin: string }
export type HardwareWire = { id: string; from: WireEndpoint; to: WireEndpoint; color: string }
export type Firmware = { filename: string; source: string; revision: number }
export type HardwareArtifact = {
  id: string; format: string; board: string; source_revision: number; project_revision: number; hex: string; url?: string
}
export type CompilerResult = {
  status: string; source_revision?: number; project_revision?: number; stdout?: string; stderr?: string
  errors?: unknown[]; artifact?: HardwareArtifact | null; source?: string
}
export type HardwareProject = {
  id: string; schema_version: number; revision: number; name: string; board: string
  components: HardwareComponent[]; wires: HardwareWire[]; firmware: Firmware
  history: { revision: number; operation: string }[]; compiler: CompilerResult | null
  runtime_token: string; created_at: string; updated_at: string
}
export type HardwareProjectSummary = Pick<HardwareProject, 'id' | 'name' | 'board' | 'revision' | 'created_at' | 'updated_at'>
export type CatalogComponent = {
  id?: string; type?: string; name: string; category?: string; description?: string; thumbnail?: string; tagName?: string
  pins?: (string | HardwarePin)[]; connectable?: boolean; simulation_supported?: boolean
  properties?: unknown; defaultValues?: Record<string, unknown>; supported_board?: boolean; schematic_only?: boolean; compile?: boolean; simulation?: string; unavailable_reason?: string
}
export type HardwareCommand =
  | 'read_project' | 'search_components' | 'add_component' | 'remove_component' | 'modify_component'
  | 'connect_wire' | 'remove_wire' | 'generate_firmware' | 'read_firmware' | 'edit_firmware'
  | 'compile_firmware' | 'run_simulation' | 'stop_simulation' | 'read_simulation_results'
  | 'read_compiler_errors' | 'calculator' | 'undo'

export class HardwareApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HardwareApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hardware${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : `Hardware request failed (${response.status}).`
    throw new HardwareApiError(detail, response.status)
  }
  if (body === null) throw new HardwareApiError('Hardware server returned an invalid response.', response.status)
  return body as T
}

export const hardwareApi = {
  listProjects: () => request<{ projects: HardwareProjectSummary[] }>('/projects'),
  createProject: (name: string) => request<HardwareProject>('/projects', {
    method: 'POST', body: JSON.stringify({ name, board: 'unselected' }),
  }),
  deleteProject: (id: string) => request<{ deleted: string }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getProject: (id: string) => request<HardwareProject>(`/projects/${encodeURIComponent(id)}`),
  catalog: (query = '', limit = 200) => request<{ components: CatalogComponent[]; boards: CatalogComponent[] }>(
    `/catalog?q=${encodeURIComponent(query)}&limit=${limit}`,
  ),
  command: <T = HardwareProject>(project: Pick<HardwareProject, 'id' | 'runtime_token'>, name: HardwareCommand, args: Record<string, unknown> = {}) =>
    request<T>(`/project/${encodeURIComponent(project.id)}/command`, {
      method: 'POST', body: JSON.stringify({ name, args, runtime_token: project.runtime_token }),
    }),
}

export function catalogType(component: CatalogComponent): string {
  return component.type ?? component.id ?? ''
}

export function catalogPins(component?: CatalogComponent): string[] {
  if (component?.connectable === false) return []
  return (component?.pins ?? []).map(pin => typeof pin === 'string' ? pin : pin.name).filter(Boolean)
}

export function isHardwareProject(value: unknown): value is HardwareProject {
  return !!value && typeof value === 'object' && 'id' in value && 'components' in value && 'firmware' in value && 'revision' in value
}

export function artifactIsCurrent(project: HardwareProject): boolean {
  const artifact = project.compiler?.artifact
  return project.compiler?.status === 'simulation_ready' && !!artifact &&
    artifact.source_revision === project.firmware.revision && artifact.board === project.board
}

export function runtimeUrl(project: Pick<HardwareProject, 'id' | 'runtime_token'>): string {
  const url = new URL(`/api/hardware/project/${encodeURIComponent(project.id)}/runtime`, window.location.href)
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', project.runtime_token)
  return url.toString()
}
