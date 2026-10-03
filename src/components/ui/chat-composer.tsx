import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUp, ChevronDown, LoaderCircle, Square } from 'lucide-react'
import type { ModelOption, ModelProvider } from '@/lib/model-selection'
import { Textarea } from './textarea'

type Props = { value: string; onChange: (value: string) => void; onSend: () => void; onStop: () => void; busy: boolean; provider?: ModelProvider; models?: ModelOption[]; onProviderChange?: (provider: ModelProvider) => void }

const autoMinHeight = 56
const autoMaxHeight = 200
const manualMinHeight = 72
const manualMaxHeight = 560

export function ChatComposer({ value, onChange, onSend, onStop, busy, provider, models, onProviderChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Fixed height is set by dragging the top edge; double-click returns to auto-grow.
  const [fixedHeight, setFixedHeight] = useState<number | null>(null)
  const grip = useRef<{ startY: number; startHeight: number } | null>(null)
  useLayoutEffect(() => {
    if (fixedHeight !== null || !ref.current) return
    ref.current.style.height = '0px'
    ref.current.style.height = `${Math.min(autoMaxHeight, Math.max(autoMinHeight, ref.current.scrollHeight))}px`
  }, [value, fixedHeight])
  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !ref.current) return
    event.preventDefault()
    grip.current = { startY: event.clientY, startHeight: ref.current.offsetHeight }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('chat-resizing-row')
  }
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!grip.current) return
    const next = Math.round(Math.min(manualMaxHeight, Math.max(manualMinHeight, grip.current.startHeight - (event.clientY - grip.current.startY))))
    setFixedHeight(next)
  }
  const onGripEnd = () => {
    grip.current = null
    document.body.classList.remove('chat-resizing-row')
  }
  return (
    <form onSubmit={event => { event.preventDefault(); if (!busy) onSend() }} className="relative rounded-xl border border-neutral-800 bg-neutral-900 shadow-lg shadow-black/30 transition-colors focus-within:border-neutral-600">
      <div role="separator" aria-orientation="horizontal" aria-label="Resize message box" title="Drag to resize — double-click to reset"
        onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripEnd} onPointerCancel={onGripEnd} onDoubleClick={() => setFixedHeight(null)}
        className="absolute inset-x-0 -top-2 z-10 h-2.5 cursor-row-resize touch-none after:absolute after:left-1/2 after:top-0 after:h-[3px] after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-neutral-600/0 hover:after:bg-neutral-600/70" />
      <Textarea ref={ref} aria-label="Message WireUp" placeholder="Ask anything…" value={value} maxLength={16000}
        onChange={event => onChange(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!busy) onSend()
          }
        }} className="min-h-[56px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm leading-6 text-white placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-0" style={fixedHeight !== null ? { height: fixedHeight, overflowY: 'auto' } : { overflowY: 'auto' }} />
      <div className="flex items-center justify-between gap-3 px-2.5 pb-2 pt-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {provider && models && onProviderChange && (
            <div className="relative min-w-0">
              <select aria-label="Chat model" value={provider} disabled={busy} onChange={event => onProviderChange(event.target.value as ModelProvider)} className="max-w-[220px] appearance-none rounded-md border border-neutral-800 bg-neutral-900 py-1 pl-2 pr-7 text-[11px] font-medium text-neutral-300 outline-none transition-colors hover:border-neutral-600 focus-visible:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50">{models.map(option => <option key={option.id} value={option.id}>{option.label} · {option.model}{option.configured ? '' : ' (key needed)'}</option>)}</select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500" />
            </div>
          )}
          {busy ? <span className="flex items-center gap-2 text-[11px] font-medium text-neutral-400"><LoaderCircle size={12} className="animate-spin" />Generating…</span>
            : <span className="hidden items-center gap-1.5 text-[11px] text-neutral-600 sm:flex"><kbd className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-px font-sans text-[10px] font-medium text-neutral-500">Shift + Enter</kbd>for a new line</span>}
        </div>
        {busy ? <button type="button" onClick={onStop} aria-label="Stop generation" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Square size={13} fill="currentColor" strokeWidth={0} /></button>
          : <button type="submit" disabled={!value.trim()} aria-label="Send" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600"><ArrowUp size={17} strokeWidth={2.5} /></button>}
      </div>
    </form>
  )
}
