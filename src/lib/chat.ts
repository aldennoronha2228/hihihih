import { readActivityStream } from '@/components/ui/agent-activity-feed'
import type { FeasibilityReport } from '@/components/ui/feasibility-card'
import type { ModelProvider } from '@/lib/model-selection'
import type { ProjectQuestions } from '@/components/ui/project-questions'
import type { ActivityBlock } from '@/components/ui/agent-activity-feed'

export type Message = {
  hidden?: boolean
  blocks?: ActivityBlock[]
  questions?: ProjectQuestions
  feasibility?: FeasibilityReport
  feasibilityChoice?: string
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'streaming' | 'done' | 'error' | 'stopped'
  error?: string
  startedAt?: number
  elapsedMs?: number
  model?: string
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number; output_token_details?: { reasoning?: number } }
}
export type ChatEvent = { id?: string; project_id?: string; revision?: number; issues?: FeasibilityReport['issues']; choices?: FeasibilityReport['choices']; questions?: ProjectQuestions['questions']; summary?: string; status?: string; reason?: string; type: string; text?: string; message?: string; model?: string; elapsedMs?: number; usage?: Message['usage'] | null }
export type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number; requirements?: Record<string, string>; projectId?: string }
export const storageKey = 'wireup.chats.v1'

export function readChats(key = storageKey): { chats: Conversation[]; warning: string } {
  try {
    const raw = localStorage.getItem(key) ?? (key === storageKey ? localStorage.getItem('simply.chats.v1') : null)
    if (!raw) return { chats: [], warning: '' }
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data) || data.length > 100) throw new Error()
    for (const chat of data) {
      if (!chat || typeof chat.id !== 'string' || typeof chat.title !== 'string' || !Array.isArray(chat.messages) || typeof chat.updatedAt !== 'number') throw new Error()
      for (const message of chat.messages) {
        if (!message || typeof message.id !== 'string' || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error()
        if (message.blocks !== undefined && (!Array.isArray(message.blocks) || message.blocks.some((block: ActivityBlock) => !block || typeof block.id !== 'string' || (block.type === 'text' ? typeof block.text !== 'string' : block.type !== 'step' || typeof block.label !== 'string' || typeof block.command !== 'string' || typeof block.output !== 'string' || !['running', 'success', 'error', 'stopped'].includes(block.status))))) throw new Error()
        if (message.blocks) message.blocks = message.blocks.map((block: ActivityBlock) => block.type === 'step' && block.status === 'running' ? { ...block, status: 'stopped', output: 'Generation interrupted by reload.' } : block)
        if (message.model !== undefined && typeof message.model !== 'string') throw new Error()
        if (message.elapsedMs !== undefined && (typeof message.elapsedMs !== 'number' || !Number.isFinite(message.elapsedMs))) throw new Error()
        if (message.startedAt !== undefined && (typeof message.startedAt !== 'number' || !Number.isFinite(message.startedAt))) throw new Error()
        if (message.usage !== undefined && (!message.usage || !['input_tokens', 'output_tokens', 'total_tokens'].every(key => typeof message.usage[key] === 'number'))) throw new Error()
        if (message.status === 'streaming') message.status = 'stopped'
      }
    }
    return { chats: data as Conversation[], warning: '' }
  } catch {
    return { chats: [], warning: 'Saved chats could not be loaded. You can start a new conversation.' }
  }
}

export async function streamReply(
  messages: Message[], signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
  scope: { projectId?: string; runtimeToken?: string; answers?: Record<string, string>; provider?: ModelProvider; approval?: { assessment_id: string; choice: string } } = {},
) {
  const requestController = new AbortController()
  const cancel = () => requestController.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let headerTimeout = false
  const timer = setTimeout(() => { headerTimeout = true; requestController.abort() }, 30_000)
  try {
  const response = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: requestController.signal,
    body: JSON.stringify({ provider: scope.provider || 'groq', project_id: scope.projectId, runtime_token: scope.runtimeToken, project_answers: scope.answers, approval: scope.approval, messages: messages.filter(m => m.content.trim() && (m.role === 'user' || m.status === 'done')).map(({ role, content }) => ({ role, content })) }),
  })
  clearTimeout(timer)
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const details = Array.isArray(error?.detail) ? error.detail.map((item: { loc?: (string | number)[]; msg?: string }) => `${item.loc?.filter(value => value !== 'body').join('.') || 'request'}: ${item.msg || 'Invalid value'}`).join('; ') : null
    throw new Error(typeof error?.detail === 'string' ? error.detail : details || `Chat request failed (${response.status}). Please try again.`)
  }
  await readActivityStream(response, onEvent)
  } catch (error) {
    if (headerTimeout) throw new Error('The AI server did not start a response within 30 seconds. Restart the backend or retry with another model.')
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    requestController.abort()
  }
}
