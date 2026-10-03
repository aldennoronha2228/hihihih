import { useState } from 'react'

export type ProjectQuestion = { id: string; question: string; options: { id: string; label: string; description?: string }[] }
export type ProjectQuestions = { summary: string; questions: ProjectQuestion[] }

export function ProjectQuestionForm({ data, onConfirm, disabled }: { data: ProjectQuestions; onConfirm: (answers: Record<string, string>) => void; disabled?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  return <form aria-label="Project requirements" onSubmit={event => { event.preventDefault(); if (data.questions.every(question => answers[question.id])) { setSubmitted(true); onConfirm(answers) } }} className="space-y-5 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div><h3 className="text-sm font-medium text-white">Project requirements</h3><p className="mt-2 text-xs leading-5 text-neutral-400">{data.summary}</p></div>
    {data.questions.map((question, index) => <fieldset key={question.id} disabled={disabled || submitted} className="space-y-2"><legend className="mb-2 text-xs font-medium text-neutral-200">{index + 1}. {question.question}</legend>{question.options.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${answers[question.id] === option.id ? 'border-[#4a8fd9]/60 bg-[#4a8fd9]/10' : 'border-neutral-700 hover:border-neutral-500'}`}><input type="radio" name={question.id} value={option.id} checked={answers[question.id] === option.id} onChange={() => setAnswers({ ...answers, [question.id]: option.id })} className="mt-0.5 accent-[#4a8fd9]" /><span><strong className="font-medium text-neutral-200">{option.label}</strong>{option.description && <span className="mt-1 block text-neutral-400">{option.description}</span>}</span></label>)}</fieldset>)}
    <button type="submit" disabled={disabled || submitted || !data.questions.every(question => answers[question.id])} className="w-full rounded-lg bg-[#4a8fd9] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#5f9de2] disabled:opacity-40">{submitted ? 'Requirements confirmed' : 'Confirm and build circuit'}</button>
  </form>
}
