import { expect, test } from '@playwright/test'
import metadata from '../vendor/velxio/frontend/public/components-metadata.json' with { type: 'json' }
import type { HardwareProject } from '../src/lib/hardware'

test.use({ baseURL: process.env.SPICE_BASE_URL ?? 'http://127.0.0.1:5173' })

const presets = metadata.components.filter(entry => entry.tags?.includes('preset') &&
  ['wokwi-resistor', 'wokwi-capacitor', 'velxio-capacitor-electrolytic', 'wokwi-inductor'].includes(entry.tagName))

function divider(): HardwareProject {
  return {
    id: 'passive-test', schema_version: 1, revision: 1, name: 'Passive divider', board: 'arduino-uno',
    components: [
      { id: 'supply', type: 'source-dc-voltage', x: 0, y: 0, rotation: 0, properties: { voltage: 5 } },
      { id: 'r1', type: 'resistor-220', x: 100, y: 0, rotation: 0, properties: {} },
      { id: 'r2', type: 'resistor-220', x: 200, y: 0, rotation: 0, properties: {} },
      { id: 'gnd', type: 'ground', x: 200, y: 100, rotation: 0, properties: {} },
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
}

function shunt(type: string): HardwareProject {
  const project = divider()
  const polarized = type === 'capacitor-electrolytic' || type.startsWith('cap-elec-')
  project.components.push({ id: 'passive', type, x: 300, y: 0, rotation: 0, properties: {} })
  project.wires.push(
    { id: 'w5', from: { component: 'r1', pin: '2' }, to: { component: 'passive', pin: polarized ? '+' : '1' }, color: '#70d7aa' },
    { id: 'w6', from: { component: 'passive', pin: polarized ? '−' : '2' }, to: { component: 'gnd', pin: 'GND' }, color: '#70d7aa' },
  )
  return project
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Passive SPICE test</body></html>' }))
  await page.goto('/')
})

test('all 27 catalog presets preserve exact defaults, upstream cards, and actual pin names', async ({ page }) => {
  expect(presets).toHaveLength(27)
  const cases = presets.map(entry => ({ entry, project: shunt(entry.id) }))
  const results = await page.evaluate(async cases => {
    const path = '/src/hardware/spice.ts'
    const upstreamPath = '/vendor/velxio/frontend/src/simulation/spice/componentToSpice.ts'
    const elementPath = '/vendor/velxio/frontend/src/velxio-elements/capacitor-electrolytic-element.ts'
    const { analogPins, buildAnalogNetlist, parseAnalogValue } = await import(/* @vite-ignore */ path)
    const { PASSIVE_PRESETS, componentToSpice } = await import(/* @vite-ignore */ upstreamPath)
    await import(/* @vite-ignore */ elementPath)
    const element = document.createElement('velxio-capacitor-electrolytic') as HTMLElement & { pinInfo: { name: string }[] }
    return cases.map(({ entry, project }) => {
      const pins = analogPins({ type: entry.id })
      const built = buildAnalogNetlist(project)
      const value = parseAnalogValue(entry.defaultValues.value)
      const upstream = componentToSpice({ id: 'part_4', metadataId: PASSIVE_PRESETS[entry.id], properties: { ...entry.defaultValues, value } },
        (pin: string) => pin === pins[0] ? 'part_4_sense_node' : built.pinNetMap[`passive:${pin}`], { vcc: 5 })
      const explicit = structuredClone(project)
      explicit.components[4].properties = entry.defaultValues
      return { id: entry.id, pins, elementPins: element.pinInfo.map(pin => pin.name), built,
        explicit: buildAnalogNetlist(explicit).netlist, upstreamCards: upstream?.cards, value }
    })
  }, cases)
  for (const result of results) {
    expect(result.built.diagnostics, result.id).toEqual([])
    expect(result.explicit, result.id).toBe(result.built.netlist)
    expect(result.upstreamCards, result.id).toHaveLength(1)
    expect(result.built.netlist, result.id).toContain(result.upstreamCards[0])
    expect(result.pins, result.id).toEqual(result.id.startsWith('cap-elec-') ? result.elementPins : ['1', '2'])
    expect(result.built.pinNetMap[`passive:${result.pins[0]}`], result.id).toBe(result.built.pinNetMap['r1:2'])
    expect(result.built.pinNetMap[`passive:${result.pins[1]}`], result.id).toBe('0')
    expect(result.built.netlist, result.id).not.toContain('R_autopull')
  }
})

test('real ngspice solves the 5 V 220 ohm preset divider with catalog defaults', async ({ page }) => {
  const result = await page.evaluate(async project => {
    const path = '/src/hardware/spice.ts'
    const { solveAnalog } = await import(/* @vite-ignore */ path)
    return solveAnalog(project)
  }, divider())
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
  expect(result.nodeVoltages[result.pinNetMap['r1:2']][0]).toBeCloseTo(2.5, 8)
  expect(result.componentCurrents.r1[0]).toBeCloseTo(5 / 440, 8)
  expect(result.componentCurrents.supply[0]).toBeCloseTo(-5 / 440, 8)
  expect(result.netlist).toMatch(/R_part_1 \S+ \S+ 220/)
})

for (const type of ['cap-100n', 'cap-elec-10u', 'ind-1m']) {
  test(`real ngspice DC and pulse transient solve ${type}`, async ({ page }) => {
    const project = shunt(type)
    const inductive = type === 'ind-1m'
    const step = inductive ? '50n' : '1u'
    const stop = inductive ? '50u' : '5m'
    const result = await page.evaluate(async ({ project, step, stop }) => {
      const path = '/src/hardware/spice.ts'
      const { solveAnalog } = await import(/* @vite-ignore */ path)
      const dc = await solveAnalog(project)
      const pulse = structuredClone(project)
      pulse.components[0].type = 'source-pulse-voltage'
      pulse.components[0].properties = { low: 0, high: 5, delay: 1e-6, rise: 1e-9, fall: 1e-9, width: 0.01, period: 0.02 }
      return { dc, transient: await solveAnalog(pulse, { analysis: 'transient', step, stop }) }
    }, { project, step, stop })
    expect(result.dc.ok, JSON.stringify(result.dc.diagnostics)).toBe(true)
    expect(result.dc.nodeVoltages[result.dc.pinNetMap['r1:2']][0]).toBeCloseTo(inductive ? 0 : 2.5, 8)
    expect(result.dc.componentCurrents.passive[0]).toBeCloseTo(inductive ? 5 / 220 : 0, 8)
    const transient = result.transient
    expect(transient.ok, JSON.stringify(transient.diagnostics)).toBe(true)
    const voltage = transient.nodeVoltages[transient.pinNetMap['r1:2']]
    expect(voltage).toHaveLength(transient.time.length)
    expect(transient.componentCurrents.passive).toHaveLength(transient.time.length)
    const tau = inductive ? 0.001 / 110 : 110 * (type === 'cap-elec-10u' ? 10e-6 : 100e-9)
    const index = transient.time.findIndex((time: number) => time >= 1e-6 + tau)
    expect(index).toBeGreaterThan(0)
    const decay = Math.exp(-(transient.time[index] - 1e-6) / tau)
    expect(voltage[index]).toBeCloseTo(2.5 * (inductive ? decay : 1 - decay), 2)
    expect(Math.max(...voltage)).toBeGreaterThan(2)
  })
}

test('preset overrides and inclusive RLC bounds reach the upstream mapper unchanged', async ({ page }) => {
  const results = await page.evaluate(async project => {
    const path = '/src/hardware/spice.ts'
    const { buildAnalogNetlist, analogPins, parseAnalogValue } = await import(/* @vite-ignore */ path)
    return ['resistor-220', 'cap-100n', 'cap-elec-10u', 'ind-1m'].flatMap(type => {
      const values = type === 'resistor-220' ? ['1e-6', '1e12', '1Meg', '1M'] : ['1e-15', '1e6', '22u']
      return values.map(value => {
        const changed = structuredClone(project)
        changed.components[4].type = type
        changed.components[4].properties = { value }
        const pins = analogPins({ type })
        changed.wires[4].to.pin = pins[0]
        changed.wires[5].from.pin = pins[1]
        const built = buildAnalogNetlist(changed)
        return { type, value: parseAnalogValue(value), card: built.netlist.split('\n').find((line: string) => /^[RCL]_part_4 /.test(line)) }
      })
    })
  }, shunt('cap-elec-10u'))
  for (const result of results) expect(Number(result.card.split(/\s+/)[3]), result.type).toBe(result.value)
})

test('preset validation rejects injection, wrong types, out-of-bounds RLC, and incorrect electrolytic minus pin', async ({ page }) => {
  const results = await page.evaluate(async project => {
    const path = '/src/hardware/spice.ts'
    const { buildAnalogNetlist, analogPins } = await import(/* @vite-ignore */ path)
    const invalid: { type: string; value: unknown }[] = [
      ...['resistor-220', 'cap-100n', 'cap-elec-10u', 'ind-1m'].flatMap(type =>
        [0, 220, null, '0', '-1', '1e999', '1u\nVevil 1 0 9', '1e-16', type === 'resistor-220' ? '1e13' : '1e7'].map(value => ({ type, value }))),
    ]
    const rejected = invalid.map(({ type, value }) => {
      const bad = structuredClone(project)
      bad.components[4].type = type
      bad.components[4].properties = { value }
      const pins = analogPins({ type })
      bad.wires[4].to.pin = pins[0]
      bad.wires[5].from.pin = pins[1]
      try { buildAnalogNetlist(bad); return false } catch (error) { return (error as Error).message.includes('passive.value') }
    })
    const badPin = structuredClone(project)
    badPin.wires[5].from.pin = '-'
    let pinError = ''
    try { buildAnalogNetlist(badPin) } catch (error) { pinError = (error as Error).message }
    const badRating = structuredClone(project)
    badRating.components[4].properties = { voltage: 25 }
    let ratingError = ''
    try { buildAnalogNetlist(badRating) } catch (error) { ratingError = (error as Error).message }
    return { rejected, pinError, ratingError, unsupported: ['diode-1n4148', 'ic-74hc00', 'resistor-unknown'].map(type => analogPins({ type })) }
  }, shunt('cap-elec-10u'))
  expect(results.rejected.every(Boolean)).toBe(true)
  expect(results.pinError).toContain('invalid pin passive:-')
  expect(results.ratingError).toContain('catalog type and allowed values')
  expect(results.unsupported).toEqual([[], [], []])
})
