import { expect, test } from '@playwright/test'
import type { HardwareProject } from '../src/lib/hardware'
import type { RuntimeArtifact } from '../src/hardware/runtime'

const firmware = `void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  Serial.println("C3_REAL_SETUP");
}
void loop() {
  digitalWrite(2, HIGH);
  Serial.println("C3_REAL_HIGH");
  delay(200);
  digitalWrite(2, LOW);
  Serial.println("C3_REAL_LOW");
  delay(200);
}
`

let project: HardwareProject
let artifact: RuntimeArtifact

test.describe('genuine ESP32-C3 browser runtime', () => {
  test.describe.configure({ mode: 'default' })
  test.beforeAll(async ({ request }) => {
    test.setTimeout(660_000)
    const created = await request.post('/api/hardware/projects', { data: { name: 'C3 dedicated runtime fixture', board: 'esp32-c3' } })
    expect(created.ok()).toBeTruthy()
    project = await created.json()
    const edited = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'edit_firmware', args: { source: firmware }, runtime_token: project.runtime_token } })
    expect(edited.ok()).toBeTruthy()
    project = await edited.json()
    const compiled = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'compile_firmware', args: {}, runtime_token: project.runtime_token }, timeout: 650_000 })
    expect(compiled.ok(), await compiled.text()).toBeTruthy()
    const result = await compiled.json()
    expect(result.status, result.stderr).toMatch(/compilation_complete|simulation_ready/)
    expect(result.artifact).toBeTruthy()
    artifact = result.artifact
    artifact = { ...artifact, program: artifact.program ?? artifact.bin }
    delete artifact.bin
    expect(artifact.chip).toBe('esp32c3')
    expect(artifact.image_kind).toBe('merged-flash')
    expect(artifact.size_bytes).toBe(4 * 1024 * 1024)
  })
  test.afterAll(async ({ request }) => {
    if (project) await request.delete(`/api/hardware/projects/${project.id}`)
  })

  test('validates real merged artifact and existing board pin APIs', async ({ page }) => {
    await page.route('**/c3-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>C3 runtime test</title>' }))
    await page.goto('/c3-runtime-test')
    const results = await page.evaluate(async ({ project, artifact }) => {
      const path = '/src/hardware/runtime.ts'
      const { validateRuntimeArtifact, boardPin } = await import(path)
      const errors: string[] = []
      for (const change of [{ chip: 'esp32s3' }, { board: 'esp32-s3' }, { load_address: 0x10000 }, { image_kind: 'app' }, { size_bytes: 24 }, { source_revision: -1 }, { program: 'AAAA' }]) {
        try { validateRuntimeArtifact(project, { ...artifact, ...change }); errors.push('accepted') } catch (error) { errors.push(String(error)) }
      }
      const payload = artifact.program ?? artifact.bin!
      const bytes = atob(payload)
      for (const offset of [12, 0x8000, 0x1000c, 0x1001f]) {
        const corrupted = bytes.slice(0, offset) + String.fromCharCode(bytes.charCodeAt(offset) ^ 0xff) + bytes.slice(offset + 1)
        try { validateRuntimeArtifact(project, { ...artifact, program: btoa(corrupted), bin: btoa(corrupted) }); errors.push('accepted') } catch (error) { errors.push(String(error)) }
      }
      return { valid: validateRuntimeArtifact(project, artifact).length === payload.length, errors, pins: ['2', 'GPIO2', 'RX', 'TX', 'GND.1', '22'].map(pin => boardPin('esp32-c3', pin)), oldPins: [boardPin('arduino-uno', 'A5'), boardPin('arduino-mega', 'D53'), boardPin('pi-pico', 'GP25')] }
    }, { project, artifact })
    expect(results.valid).toBeTruthy()
    expect(results.errors).not.toContain('accepted')
    expect(results.pins).toEqual([2, 2, 20, 21, null, null])
    expect(results.oldPins).toEqual([19, 53, 25])
  })

  test('rejects missing ROM and cancels asynchronous startup on stop/dispose', async ({ page }) => {
    await page.route('**/c3-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>C3 runtime test</title>' }))
    await page.goto('/c3-runtime-test')
    await page.route('**/boards/esp32c3-rom.bin', route => route.fulfill({ status: 404, body: 'missing' }))
    const missing = await page.evaluate(async ({ project, artifact }) => {
      const path = '/src/hardware/runtime.ts'
      const { HardwareRuntime } = await import(path)
      const runtime = new HardwareRuntime(() => {})
      try { await runtime.run(project, artifact); return 'accepted' } catch (error) { return String(error) } finally { runtime.dispose() }
    }, { project, artifact })
    expect(missing).toContain('ROM load failed: HTTP 404')
    await page.unroute('**/boards/esp32c3-rom.bin')
    for (const action of ['stop', 'dispose'] as const) {
      const result = await page.evaluate(async ({ project, artifact, action }) => {
        const path = '/src/hardware/runtime.ts'
        const { HardwareRuntime } = await import(path)
        const runtime = new HardwareRuntime(() => {})
        const pending = runtime.run(project, artifact).then(() => 'accepted', (error: unknown) => String(error))
        runtime[action]()
        const error = await pending
        const running = runtime.results().running
        runtime.dispose()
        return { error, running }
      }, { project, artifact, action })
      expect(result.error).toContain('startup was cancelled')
      expect(result.running).toBeFalsy()
    }
  })

  test('executes backend-compiled Serial and GPIO2 delay(200) firmware', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.route('**/c3-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>C3 runtime test</title>' }))
    await page.goto('/c3-runtime-test')
    const evidence = await page.evaluate(async ({ project, artifact }) => {
      const path = '/src/hardware/runtime.ts'
      const { HardwareRuntime } = await import(path)
      const runtime = new HardwareRuntime(() => {})
      let error: string | null = null
      try {
        await runtime.run(project, artifact)
        const deadline = performance.now() + 20_000
        while (performance.now() < deadline && !(runtime.results().serial.includes('C3_REAL_LOW') && runtime.getSamples('2').length >= 4)) await new Promise(resolve => setTimeout(resolve, 100))
      } catch (caught) { error = String(caught) }
      const beforeStop = runtime.results()
      const samples = runtime.getSamples('GPIO2')
      runtime.stop()
      const cycles = runtime.results().cycles
      await new Promise(resolve => setTimeout(resolve, 100))
      const stopped = !runtime.results().running && cycles === runtime.results().cycles
      const channels = runtime.getChannels()
      const helperPath = '/src/hardware/C3Simulator.ts'
      const { C3Simulator } = await import(helperPath)
      const simulator = (runtime as unknown as { simulator: InstanceType<typeof C3Simulator> }).simulator
      const pc = simulator instanceof C3Simulator ? simulator.getProgramCounter().toString(16) : null
      runtime.dispose()
      return { error, beforeStop, samples, stopped, channels, pc }
    }, { project, artifact })
    await testInfo.attach('actual-c3-execution', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
    expect(evidence.error).toBeNull()
    expect(evidence.stopped).toBeTruthy()
    expect(evidence.channels).toContain('GPIO2')
    expect(evidence.beforeStop.engine).toContain('Esp32C3Simulator')
    expect(evidence.beforeStop.serial, `Actual PC: 0x${evidence.pc}; cycles: ${evidence.beforeStop.cycles}`).toContain('C3_REAL_SETUP')
    expect(evidence.beforeStop.serial).toContain('C3_REAL_HIGH')
    expect(evidence.beforeStop.serial).toContain('C3_REAL_LOW')
    expect(evidence.samples.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < evidence.samples.length; i++) {
      expect(evidence.samples[i].level).not.toBe(evidence.samples[i - 1].level)
      expect(evidence.samples[i].time_ms - evidence.samples[i - 1].time_ms).toBeGreaterThanOrEqual(190)
      expect(evidence.samples[i].time_ms - evidence.samples[i - 1].time_ms).toBeLessThanOrEqual(210)
    }
  })
})
