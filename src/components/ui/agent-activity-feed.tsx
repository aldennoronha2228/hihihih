import { useEffect, useState } from 'react'
import { Check, ChevronRight, CircleX, LoaderCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './agent-activity-feed.css'

export type ActivityBlock =
  | { type: 'text'; id: string; text: string; channel?: 'answer' | 'narration' | 'thinking' }
  | { type: 'step'; id: string; label: string; command: string; status: 'running' | 'success' | 'error' | 'stopped'; output: string }
export type ActivityEvent =
  | { type: 'text'; text: string; channel?: 'answer' | 'narration' | 'thinking' }
  | { type: 'step_start'; id: string; label: string; command: string }
  | { type: 'step_end'; id: string; status: 'success' | 'error' | 'stopped'; output: string }
  | { type: 'done'; model?: string; elapsedMs?: number; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null }

export function appendActivity(blocks: ActivityBlock[], event: ActivityEvent): ActivityBlock[] {
  if (event.type === 'text') {
    const last = blocks.at(-1)
    if (last?.type === 'text' && last.channel === event.channel) return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }]
    return [...blocks, { type: 'text', id: crypto.randomUUID(), text: event.text, channel: event.channel }]
  }
  if (event.type === 'step_start') return [...blocks, { type: 'step', id: event.id, label: event.label, command: event.command, status: 'running', output: '' }]
  if (event.type === 'step_end') return blocks.map(block => block.type === 'step' && block.id === event.id ? { ...block, status: event.status, output: event.output } : block)
  return blocks
}

export async function readActivityStream(response: Response, onEvent: (event: ActivityEvent) => void) {
  if (!response.body) throw new Error('The server returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  const line = (value: string) => {
    if (!value.trim()) return
    const event = JSON.parse(value)
    if (event.type === 'error') throw new Error(event.message || 'Generation failed. Please retry.')
    if (event.type === 'done') completed = true
    onEvent(event)
  }
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The AI connection stopped sending updates for 45 seconds. Please retry or select another model.')), 45_000) }),
      ]).finally(() => clearTimeout(timer))
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const value of lines) line(value)
      if (done || completed) break
    }
    line(buffer)
    if (!completed) throw new Error('The stream ended before completion. Please retry.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

type AnswerBlock = Extract<ActivityBlock, { type: 'text' }>

function isAnswer(block: ActivityBlock): block is AnswerBlock {
  return block.type === 'text' && block.channel !== 'narration' && block.channel !== 'thinking'
}

function formatElapsed(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined
  const total = Math.round(ms / 1000)
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`
}

export function AgentActivityFeed({ blocks, running = false, outcome, startedAt, elapsedMs }: {
  blocks: ActivityBlock[]
  running?: boolean
  outcome?: 'done' | 'error' | 'stopped'
  startedAt?: number
  elapsedMs?: number
}) {
  const answers = blocks.filter(isAnswer)
  const process = blocks.filter(block => block.type === 'step' || (block.type === 'text' && (block.channel === 'narration' || (block.channel === 'thinking' && running))))
  const hasProcess = blocks.some(block => block.type === 'step' || (block.type === 'text' && block.channel === 'narration'))
  const answerNodes = answers.map(block => <div key={block.id} className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown></div>)
  if (!hasProcess) {
    return <div className="agent-feed">{process.map(block => block.type === 'text' ? <div key={block.id} className="agent-thinking"><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown></div> : null)}{answerNodes}</div>
  }
  const failed = outcome === 'error' || blocks.some(block => block.type === 'step' && (block.status === 'error' || block.status === 'stopped'))
  return (
    <div className="agent-feed">
      <section className="agent-run" aria-label="Agent steps">
        <RunHeader running={running} failed={failed} stopped={outcome === 'stopped'} startedAt={startedAt} elapsedMs={elapsedMs} />
        <div className="agent-run-body">
          {process.map(block => block.type === 'step'
            ? <StepRow key={block.id} step={block} />
            : <div key={block.id} className={block.channel === 'thinking' ? 'agent-thinking' : 'agent-narration'}><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown></div>)}
        </div>
      </section>
      {answerNodes}
    </div>
  )
}

function RunHeader({ running, failed, stopped, startedAt, elapsedMs }: { running: boolean; failed: boolean; stopped: boolean; startedAt?: number; elapsedMs?: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setTick(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const elapsed = running && startedAt ? Date.now() - startedAt : elapsedMs
  const seconds = formatElapsed(elapsed)
  const label = running ? 'Working on your project…' : stopped ? 'Generation stopped' : failed ? 'Finished with errors' : 'Finished'
  return (
    <div className="agent-run-header" role="status">
      {running ? <LoaderCircle size={14} className="agent-spin" />
        : stopped ? <CircleX size={14} className="agent-run-muted" />
          : failed ? <CircleX size={14} className="agent-run-fail" />
            : <Check size={14} className="agent-run-check" />}
      <span>{label}</span>
      {seconds !== undefined && <small>{seconds}</small>}
    </div>
  )
}

function StepRow({ step }: { step: Extract<ActivityBlock, { type: 'step' }> }) {
  const [choice, setChoice] = useState<{ status: string; open: boolean } | null>(null)
  const open = choice?.status === step.status ? choice.open : step.status === 'running'
  return <div className="agent-step"><button type="button" aria-expanded={open} onClick={() => setChoice({ status: step.status, open: !open })}>{step.status === 'running' ? <LoaderCircle size={14} className="agent-spin" /> : step.status === 'success' ? <Check size={14} className="agent-step-check" /> : <CircleX size={14} className="agent-step-fail" />}<span>{step.label}</span>{(step.status === 'error' || step.status === 'stopped') && <small>{step.status}</small>}<ChevronRight size={13} className="agent-chevron" /></button>{open && <div className="agent-step-body"><pre className="agent-command">{step.command}</pre>{step.output && <pre className="agent-output">{step.output}</pre>}</div>}</div>
}
