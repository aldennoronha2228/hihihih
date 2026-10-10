import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const catalogPath = 'vendor/velxio/frontend/public/components-metadata.json'
const registrationPath = 'vendor/velxio/frontend/src/elements-register.ts'
const outputPath = path.join(root, 'backend/catalog/component-pins.json')
const catalogSource = await readFile(path.join(root, catalogPath), 'utf8')
const registrationSource = await readFile(path.join(root, registrationPath), 'utf8')
const catalog = JSON.parse(catalogSource).components
const url = process.env.COMPONENT_PINS_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const components = {}
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async registration => {
    await import(/* @vite-ignore */ registration)
    document.body.replaceChildren()
  }, `/${registrationPath}`)
  for (const part of catalog) {
    components[part.id] = await page.evaluate(async part => {
      const record = {
        tagName: part.tagName,
        defaultValues: part.defaultValues || {},
        properties: {},
        defined: Boolean(part.tagName && customElements.get(part.tagName)),
        status: 'missing-tag',
        pins: [],
        pinCount: 0,
      }
      if (!record.defined) {
        record.error = `Custom element ${part.tagName || '(empty tag)'} is not registered.`
        return record
      }
      let element
      try {
        element = document.createElement(part.tagName)
        Object.assign(element, record.defaultValues)
        document.body.append(element)
        if (element.updateComplete) {
          await Promise.race([
            element.updateComplete,
            new Promise((_, reject) => setTimeout(() => reject(new Error('updateComplete timed out')), 5000)),
          ])
        }
        const names = new Set([
          ...Object.keys(record.defaultValues),
          ...['pins', 'protocol'].filter(name => name in element),
        ])
        for (const name of names) {
          const value = element[name]
          if (value !== undefined) record.properties[name] = JSON.parse(JSON.stringify(value))
        }
        record.pinInfoDefined = 'pinInfo' in element
        const pins = element.pinInfo
        if (!record.pinInfoDefined) {
          record.status = 'no-pins'
          record.reason = 'Registered element has no pinInfo; no physical pins are inferred.'
          return record
        }
        if (!Array.isArray(pins)) throw new Error('Element does not expose an array pinInfo.')
        record.pins = pins.map(pin => {
          if (typeof pin.name !== 'string' || !pin.name || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) {
            throw new Error('pinInfo contains an invalid name or coordinate.')
          }
          const result = { name: pin.name, x: pin.x, y: pin.y }
          if (pin.label !== undefined) result.label = pin.label
          return result
        })
        record.pinCount = record.pins.length
        record.status = record.pinCount ? 'verified' : 'no-pins'
      } catch (error) {
        record.status = 'extraction-error'
        record.error = String(error.message || error)
        record.pins = []
        record.pinCount = 0
      } finally {
        element?.remove()
      }
      return record
    }, part)
  }
  const records = Object.entries(components)
  const counts = {
    catalog: catalog.length,
    defined: records.filter(([, part]) => part.defined).length,
    verified: records.filter(([, part]) => part.status === 'verified').length,
    noPins: records.filter(([, part]) => part.status === 'no-pins').length,
    missingTags: records.filter(([, part]) => part.status === 'missing-tag').length,
    extractionErrors: records.filter(([, part]) => part.status === 'extraction-error').length,
    pins: records.reduce((total, [, part]) => total + part.pinCount, 0),
  }
  const failures = records.filter(([, part]) => part.error).map(([id, part]) => ({ id, tagName: part.tagName, status: part.status, error: part.error }))
  const result = {
    schema_version: 1,
    provenance: {
      extractor: 'scripts/extract-component-pins.mjs',
      catalog: catalogPath,
      catalogSha256: createHash('sha256').update(catalogSource).digest('hex'),
      registration: registrationPath,
      registrationSha256: createHash('sha256').update(registrationSource).digest('hex'),
      browser: `Chromium ${browser.version()}`,
      url,
      extractedAt: new Date().toISOString(),
      method: 'Registered custom element; Object.assign(defaultValues) before updateComplete; read pinInfo. No pinCount fallback.',
    },
    counts,
    failures,
    components,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ output: 'backend/catalog/component-pins.json', counts, failures }, null, 2))
  if (counts.extractionErrors) process.exitCode = 1
} finally {
  await browser.close()
}
