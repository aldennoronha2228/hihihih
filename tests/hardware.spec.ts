import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { HardwareProject } from '../src/lib/hardware'

const blink = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); delay(1000); }'
function fixture(): HardwareProject {
  return {
    id: 'test-uno', schema_version: 1, revision: 1, name: 'Blink workbench', board: 'arduino-uno',
    components: [{ id: 'board', type: 'arduino-uno', x: 120, y: 100, rotation: 0, properties: {} }], wires: [],
    firmware: { filename: 'sketch.ino', source: blink, revision: 1 }, history: [], compiler: null,
    runtime_token: 'browser-test-token', created_at: '2026-10-03', updated_at: '2026-10-03',
  }
}
const catalog = [
  { id: 'arduino-uno', name: 'Arduino Uno', category: 'boards', pins: ['13', 'GND'], connectable: true },
  { id: 'led', name: 'LED', category: 'output', pins: ['A', 'C'], connectable: true, defaultValues: { color: 'red' } },
  { id: 'resistor', name: 'Resistor', category: 'passive', pins: ['1', '2'], connectable: true, defaultValues: { value: '220' } },
]

async function mockHardware(page: Page) {
  let project = fixture()
  const requests: { name: string; args: Record<string, unknown>; runtime_token: string }[] = []
  await page.route('**/api/health', route => route.fulfill({ json: { configured: false } }))
  await page.route('**/api/hardware/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/catalog')) {
      const q = url.searchParams.get('q')?.toLowerCase() ?? ''
      return route.fulfill({ json: { components: catalog.filter(part => part.name.toLowerCase().includes(q)), boards: [] } })
    }
    if (url.pathname.endsWith('/projects')) {
      return route.fulfill({ json: route.request().method() === 'POST' ? project : { projects: [project] } })
    }
    if (url.pathname.endsWith('/command')) {
      const body = route.request().postDataJSON()
      requests.push(body)
      if (body.args.expected_revision !== undefined && body.args.expected_revision !== project.revision) return route.fulfill({ status: 409, json: { detail: 'Project revision changed. Refresh and retry.' } })
      const previous = structuredClone(project)
      if (body.name === 'add_component') project.components.push({ id: body.args.type + '-1', type: body.args.type, x: body.args.x, y: body.args.y, rotation: 0, properties: { color: 'red' } })
      else if (body.name === 'remove_component') { project.components = project.components.filter(part => part.id !== body.args.id); project.wires = project.wires.filter(wire => wire.from.component !== body.args.id && wire.to.component !== body.args.id) }
      else if (body.name === 'modify_component') { const part = project.components.find(part => part.id === body.args.id)!; Object.assign(part, body.args); delete (part as unknown as Record<string, unknown>).expected_revision }
      else if (body.name === 'connect_wire') project.wires.push({ id: 'wire-1', from: body.args.from, to: body.args.to, color: body.args.color })
      else if (body.name === 'remove_wire') project.wires = project.wires.filter(wire => wire.id !== body.args.id)
      else if (body.name === 'edit_firmware' || body.name === 'generate_firmware') project.firmware = { ...project.firmware, source: body.args.source, revision: project.firmware.revision + 1 }
      else if (body.name === 'compile_firmware') {
        project.compiler = { status: 'error', source_revision: project.firmware.revision, project_revision: project.revision, stdout: '', stderr: 'sketch.ino:2: error: deliberate compiler diagnostic', artifact: null }
        return route.fulfill({ json: project.compiler })
      } else if (body.name === 'read_compiler_errors') return route.fulfill({ json: project.compiler ?? { status: 'not_compiled', errors: [] } })
      else if (body.name === 'read_firmware') return route.fulfill({ json: project.firmware })
      else if (body.name === 'read_project') return route.fulfill({ json: project })
      else if (body.name === 'search_components') return route.fulfill({ json: { components: catalog } })
      else if (body.name === 'calculator') return route.fulfill({ json: { expression: body.args.expression, result: 150 } })
      else if (body.name === 'undo') project = { ...previous, components: previous.components.filter(part => part.type === 'arduino-uno') }
      project.revision++
      project.history.push({ revision: project.revision, operation: body.name })
      return route.fulfill({ json: project })
    }
    return route.fulfill({ json: project })
  })
  await page.routeWebSocket('**/api/hardware/project/*/runtime*', socket => {
    socket.send(JSON.stringify({ type: 'runtime_connected', project_id: 'test-uno' }))
  })
  return requests
}

for (const width of [1440, 390]) {
  test(`canonical circuit edits, firmware diagnostics and responsive panels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const requests = await mockHardware(page)
    await page.goto('/project/test-uno', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Blink workbench', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Firmware source' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Expand console' })).toBeVisible()
    await expect(page.locator('.hw-dock-body')).toHaveCount(0)
    if (width < 600) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    const canvasHeight = await page.getByLabel('Circuit canvas', { exact: true }).evaluate(element => element.getBoundingClientRect().height)
    expect(canvasHeight).toBeGreaterThan(width < 600 ? 550 : 650)
    await page.getByRole('tab', { name: 'Schematic', exact: true }).click()
    await expect(page.getByLabel('Schematic view', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
    if (width < 600) await page.getByRole('button', { name: 'Parts', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search components' }).fill('LED')
    await page.getByRole('button', { name: 'Add LED output', exact: true }).click()
    await expect(page.getByRole('button', { name: 'led-1 led', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'led-1 led', exact: true }).click()
    await page.getByRole('textbox', { name: 'Component properties JSON' }).fill('{"color":"blue"}')
    await page.getByRole('button', { name: 'Apply properties' }).click()
    await page.getByRole('combobox', { name: 'Wire from pin' }).selectOption(JSON.stringify({ component: 'board', pin: '13' }))
    await page.getByRole('combobox', { name: 'Wire to pin' }).selectOption(JSON.stringify({ component: 'led-1', pin: 'A' }))
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Delete wire wire-1' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete wire wire-1' }).click()
    if (width < 900) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.getByRole('button', { name: 'Sketch', exact: true }).click()
    const source = page.getByRole('textbox', { name: 'Firmware source' })
    await source.fill(blink + '\n// edited')
    await page.getByRole('button', { name: 'Save sketch', exact: true }).click()
    await expect(page.getByText('Firmware saved to the canonical project.')).toBeVisible()
    await page.getByRole('button', { name: 'Compile', exact: true }).click()
    await expect(page.locator('.hw-dock')).toContainText('deliberate compiler diagnostic')
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('textbox', { name: 'Calculator expression' }).fill('(5 - 2) / 0.02')
    await page.getByRole('button', { name: 'Calculate', exact: true }).click()
    await expect(page.getByLabel('Tool result')).toContainText('150')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Sketch', exact: true }).click()
    await expect(source).toHaveValue(blink + '\n// edited')
    await page.getByRole('button', { name: 'Close Sketch', exact: true }).click()
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Calculator expression' })).toBeVisible()
    await page.getByRole('button', { name: 'Collapse console' }).click()
    await expect(page.locator('.hw-dock-body')).toHaveCount(0)
    if (width < 600) {
      await page.getByRole('button', { name: 'Agent', exact: true }).click()
      await expect(page.locator('.hw-agent-panel')).toBeVisible()
      await page.getByRole('button', { name: 'Canvas', exact: true }).click()
      await expect(page.getByLabel('Circuit canvas', { exact: true })).toBeVisible()
    }
    expect(requests.filter(request => ['add_component', 'modify_component', 'connect_wire', 'remove_wire', 'edit_firmware'].includes(request.name)).every(request => typeof request.args.expected_revision === 'number' && request.runtime_token === 'browser-test-token')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/hardware-${width}.png` })
  })
}

test('project list creates and opens a canonical Uno project', async ({ page }) => {
  await mockHardware(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Blink workbench/ })).toBeVisible()
  await page.getByRole('button', { name: 'New prototype', exact: true }).click()
  await expect(page).toHaveURL('/project/test-uno')
  await page.getByRole('button', { name: 'Sketch', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Firmware source' })).toHaveValue(blink)
})

test('genuine AVR executes a correlated run, reports pins and stops', async ({ page, request }) => {
  test.setTimeout(150_000)
  const create = await request.post('/api/hardware/projects', { data: { name: 'Browser AVR verification', board: 'arduino-uno' } })
  expect(create.ok(), await create.text()).toBe(true)
  const project = await create.json() as HardwareProject
  await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Runtime: Connected')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 90_000 })
  const compiledProject = await (await request.get(`/api/hardware/projects/${project.id}`)).json()
  expect(compiledProject.compiler.status).toBe('simulation_ready')
  expect(compiledProject.compiler.artifact.hex).toMatch(/^:/)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  const read = () => request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'read_simulation_results', args: {}, runtime_token: project.runtime_token } })
  const firstResponse = await read()
  expect(firstResponse.ok()).toBe(true)
  const first = (await firstResponse.json()).result
  expect(first.running).toBe(true)
  expect(first.cycles).toBeGreaterThan(0)
  expect(first.engine).toContain('Velxio')
  const levels = new Set<boolean>()
  await expect.poll(async () => {
    const response = await read()
    const result = (await response.json()).result
    if (typeof result.pins.D13.level === 'boolean') levels.add(result.pins.D13.level)
    return levels.size
  }, { timeout: 8000, intervals: [180] }).toBe(2)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  const stopped = (await (await read()).json()).result
  expect(stopped.running).toBe(false)
  const after = (await (await read()).json()).result
  expect(after.cycles).toBe(stopped.cycles)
})
