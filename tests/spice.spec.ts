import { expect, test } from '@playwright/test'

test.use({ baseURL: process.env.SPICE_BASE_URL ?? 'http://127.0.0.1:5173' })

const divider = {
  id: 'analog-test', schema_version: 1, revision: 1, name: 'Divider', board: 'arduino-uno',
  components: [
    { id: 'supply', type: 'source-dc-voltage', x: 100, y: 100, rotation: 0, properties: { voltage: 5 } },
    { id: 'r1', type: 'resistor', x: 300, y: 100, rotation: 0, properties: { value: '1k' } },
    { id: 'r2', type: 'resistor', x: 500, y: 100, rotation: 0, properties: { value: '1k' } },
    { id: 'gnd', type: 'ground', x: 300, y: 300, rotation: 0, properties: {} },
  ],
  wires: [
    { id: 'w1', from: { component: 'supply', pin: '+' }, to: { component: 'r1', pin: '1' }, color: '#70d7aa' },
    { id: 'w2', from: { component: 'r1', pin: '2' }, to: { component: 'r2', pin: '1' }, color: '#70d7aa' },
    { id: 'w3', from: { component: 'r2', pin: '2' }, to: { component: 'gnd', pin: 'GND' }, color: '#70d7aa' },
    { id: 'w4', from: { component: 'supply', pin: '-' }, to: { component: 'gnd', pin: 'GND' }, color: '#70d7aa' },
  ],
  firmware: { filename: 'main.ino', source: '', revision: 1 }, history: [], compiler: null,
  runtime_token: '', created_at: '', updated_at: '',
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>SPICE test</body></html>' }))
  await page.goto('/')
})

test('real ngspice WASM solves 5 V resistor divider and branch current', async ({ page }) => {
  const response = await page.evaluate(async project => {
    const path = '/src/hardware/spice.ts'
    const { solveAnalog } = await import(/* @vite-ignore */ path)
    return solveAnalog(project)
  }, divider)
  expect(response.ok, JSON.stringify(response.diagnostics)).toBe(true)
  const net = response.pinNetMap['r1:2']
  expect(response.nodeVoltages[net][0]).toBeCloseTo(2.5, 8)
  expect(response.componentCurrents.r1[0]).toBeCloseTo(0.0025, 8)
  expect(response.componentCurrents.supply[0]).toBeCloseTo(-0.0025, 8)
  expect(response.netlist).not.toContain('R_autopull')
  expect(response.time).toEqual([])
})

test('strict validation rejects bad numbers and floating singular circuits without fabricated readings', async ({ page }) => {
  const response = await page.evaluate(async project => {
    const path = '/src/hardware/spice.ts'
    const { solveAnalog, parseAnalogValue } = await import(/* @vite-ignore */ path)
    const bad = structuredClone(project)
    bad.components[1].properties = { value: '1k\nVevil 1 0 99' }
    const floating = structuredClone(project)
    floating.components = floating.components.filter((part: { id: string }) => part.id !== 'gnd')
    floating.wires = floating.wires.filter((wire: { from: { component: string }; to: { component: string } }) => wire.from.component !== 'gnd' && wire.to.component !== 'gnd')
    return { bad: await solveAnalog(bad), floating: await solveAnalog(floating), mega: parseAnalogValue('1Meg'), milli: parseAnalogValue('1M') }
  }, divider)
  expect(response.bad.ok).toBe(false)
  expect(response.bad.diagnostics.some((item: { severity: string }) => item.severity === 'error')).toBe(true)
  expect(response.floating.ok).toBe(false)
  expect(response.floating.diagnostics.some((item: { message: string }) => /Singular circuit/.test(item.message))).toBe(true)
  expect(response.floating.nodeVoltages).toEqual({})
  expect(response.mega).toBe(1e6)
  expect(response.milli).toBe(1e-3)
})

test('real ngspice singular matrix failure returns diagnostics and no measurements', async ({ page }) => {
  const project = structuredClone(divider)
  project.components.push({ id: 'conflict', type: 'source-dc-voltage', x: 100, y: 250, rotation: 0, properties: { voltage: 3 } })
  project.wires.push(
    { id: 'w5', from: { component: 'conflict', pin: '+' }, to: { component: 'supply', pin: '+' }, color: '#70d7aa' },
    { id: 'w6', from: { component: 'conflict', pin: '-' }, to: { component: 'gnd', pin: 'GND' }, color: '#70d7aa' },
  )
  const response = await page.evaluate(async value => {
    const path = '/src/hardware/spice.ts'
    const { solveAnalog } = await import(/* @vite-ignore */ path)
    return solveAnalog(value)
  }, project)
  expect(response.ok).toBe(false)
  expect(response.diagnostics.some((item: { message: string }) => /singular|failed|convergence/i.test(item.message))).toBe(true)
  expect(response.nodeVoltages).toEqual({})
  expect(response.componentCurrents).toEqual({})
})

test('real pulse transient returns aligned time voltage and current arrays', async ({ page }) => {
  const project = structuredClone(divider)
  project.components[0].type = 'source-pulse-voltage'
  project.components[0].properties = {} as { voltage: number }
  const response = await page.evaluate(async value => {
    const path = '/src/hardware/spice.ts'
    const { solveAnalog } = await import(/* @vite-ignore */ path)
    return solveAnalog(value, { analysis: 'transient', step: '10u', stop: '2m' })
  }, project)
  expect(response.ok, JSON.stringify(response.diagnostics)).toBe(true)
  expect(response.time.length).toBeGreaterThan(100)
  expect(response.time.at(-1)).toBeCloseTo(0.002, 8)
  const voltage = response.nodeVoltages[response.pinNetMap['r1:2']]
  expect(voltage.length).toBe(response.time.length)
  expect(Math.max(...voltage)).toBeCloseTo(2.5, 6)
  expect(Math.min(...voltage)).toBeCloseTo(0, 6)
  expect(response.componentCurrents.r1.length).toBe(response.time.length)
})

test('flat schematic renders canonical wires, actual readings, selection, and pin connections', async ({ page }) => {
  await page.evaluate(async project => {
    const refreshPath = '/@react-refresh'
    const refresh = await import(refreshPath)
    refresh.default.injectIntoGlobalHook(window)
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true })
    const reactPath = '/node_modules/.vite/deps/react.js'
    const domPath = '/node_modules/.vite/deps/react-dom_client.js'
    const canvasPath = '/src/components/schematic-canvas.tsx'
    const solverPath = '/src/hardware/spice.ts'
    const [react, dom, canvas, solver] = await Promise.all([import(reactPath), import(domPath), import(canvasPath), import(solverPath)])
    const result = await solver.solveAnalog(project)
    const host = document.createElement('div')
    host.style.height = '650px'
    document.body.style.margin = '24px'
    document.body.style.background = '#0c1117'
    document.body.append(host)
    dom.default.createRoot(host).render(react.default.createElement(canvas.SchematicCanvas, {
      project, result, selectedId: 'r1',
      onSelect: (id: string) => { host.dataset.selected = id },
      onMove: (id: string, x: number, y: number) => { host.dataset.moved = id; host.dataset.position = `${x},${y}` },
      onConnect: (from: { component: string; pin: string }, to: { component: string; pin: string }) => { host.dataset.connection = `${from.component}:${from.pin}-${to.component}:${to.pin}` },
    }))
  }, divider)
  await expect(page.getByText('ngspice solved')).toBeVisible()
  await expect(page.locator('.schematic-wire')).toHaveCount(4)
  await expect(page.locator('.schematic-voltage').filter({ hasText: '2.500 V' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Select r2, Resistor', exact: true }).click()
  await expect(page.locator('[data-selected="r2"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'r1 pin 2, connect', exact: true }).click()
  await page.getByRole('button', { name: 'r2 pin 1, connect', exact: true }).click()
  await expect(page.locator('[data-connection="r1:2-r2:1"]')).toHaveCount(1)
  const box = await page.getByRole('button', { name: 'Select r2, Resistor', exact: true }).boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 20, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('[data-moved="r2"]')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/spice-schematic.png', fullPage: true })
})
