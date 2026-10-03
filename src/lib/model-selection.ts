export type ModelProvider = 'groq' | 'nvidia'
export type ModelOption = { id: ModelProvider; label: string; model: string; configured: boolean }
export const defaultModels: ModelOption[] = [
  { id: 'groq', label: 'Groq', model: 'Configured Groq model', configured: false },
  { id: 'nvidia', label: 'NVIDIA', model: 'Configured NVIDIA model', configured: false },
]
export function readModelSelection(): ModelProvider {
  try { return localStorage.getItem('wireup.model-provider') === 'nvidia' ? 'nvidia' : 'groq' }
  catch { return 'groq' }
}
