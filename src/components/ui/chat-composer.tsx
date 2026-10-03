import { useLayoutEffect, useRef } from 'react'
import { ArrowUp, ChevronDown, Square } from 'lucide-react'
import type { ModelOption, ModelProvider } from '@/lib/model-selection'
import { Textarea } from './textarea'

type Props = { value: string; onChange: (value: string) => void; onSend: () => void; onStop: () => void; busy: boolean; provider?: ModelProvider; models?: ModelOption[]; onProviderChange?: (provider: ModelProvider) => void }
export function ChatComposer({ value, onChange, onSend, onStop, busy, provider, models, onProviderChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const adjust = () => {
      if (!ref.current) return
      ref.current.style.height = '0px'
      ref.current.style.height = `${Math.min(200, Math.max(60, ref.current.scrollHeight))}px`
    }
    adjust()
    window.addEventListener('resize', adjust)
    return () => window.removeEventListener('resize', adjust)
  }, [value])
  return (
    <form onSubmit={event => { event.preventDefault(); if (!busy) onSend() }} className="rounded-3xl border border-neutral-700/60 bg-neutral-900 shadow-lg shadow-black/40 transition-colors duration-200 focus-within:border-violet-400/50 focus-within:ring-1 focus-within:ring-violet-400/20">
      <Textarea ref={ref} aria-label="Message WireUp" placeholder="Ask anything…" value={value} maxLength={16000}
        onChange={event => onChange(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!busy) onSend()
          }
        }} className="min-h-[60px] resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-6 text-white placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-0" style={{ overflowY: 'auto' }} />
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {provider && models && onProviderChange && (
            <div className="relative min-w-0">
              <select aria-label="Chat model" value={provider} disabled={busy} onChange={event => onProviderChange(event.target.value as ModelProvider)} className="max-w-[220px] appearance-none rounded-full border border-neutral-700/70 bg-neutral-800/60 py-1.5 pl-3 pr-8 text-xs font-medium text-neutral-200 outline-none transition-colors hover:border-neutral-600 hover:bg-neutral-800 focus-visible:border-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50">{models.map(option => <option key={option.id} value={option.id}>{option.label} · {option.model}{option.configured ? '' : ' (key needed)'}</option>)}</select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            </div>
          )}
          {busy ? <span className="flex items-center gap-2 text-[11px] font-medium text-neutral-400"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" /></span>Generating a response…</span>
            : <span className="hidden items-center gap-1.5 text-[11px] text-neutral-600 sm:flex"><kbd className="rounded border border-neutral-700/80 bg-neutral-800/60 px-1.5 py-px font-sans text-[10px] font-medium text-neutral-500">Shift + Enter</kbd>for a new line</span>}
        </div>
        {busy ? <button type="button" onClick={onStop} aria-label="Stop generation" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-sm transition-all hover:scale-105 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 active:scale-95"><Square size={14} fill="currentColor" strokeWidth={0} /></button>
          : <button type="submit" disabled={!value.trim()} aria-label="Send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-sm transition-all hover:scale-105 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 active:scale-95 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none disabled:hover:scale-100"><ArrowUp size={18} strokeWidth={2.5} /></button>}
      </div>
    </form>
  )
}
