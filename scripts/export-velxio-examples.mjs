import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const module = await server.ssrLoadModule('/vendor/velxio/frontend/src/data/examples.ts')
  const collection = Object.values(module).find(value => Array.isArray(value) && value.some(item => item?.id === 'blink-led'))
  if (!collection) throw new Error('Combined Velxio examples export was not found.')
  await mkdir('backend/templates', { recursive: true })
  await writeFile('backend/templates/velxio-examples.json', JSON.stringify(collection, null, 2))
  console.log(JSON.stringify({ count: collection.length, exports: Object.keys(module) }))
} finally { await server.close() }
