import { expect, test } from '@playwright/test'
import type { HardwareProject } from '../src/lib/hardware'
import type { RuntimeArtifact } from '../src/hardware/runtime'

const firmware = `void setup() {
  Serial1.setTX(0);
  Serial1.setRX(1);
  Serial1.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(3, INPUT_PULLUP);
#if !defined(ARDUINO_RASPBERRY_PI_PICO_W)
  pinMode(25, OUTPUT);
#endif
  Serial1.println("PICO_REAL_SETUP");
}
void loop() {
  digitalWrite(2, HIGH);
#if !defined(ARDUINO_RASPBERRY_PI_PICO_W)
  digitalWrite(25, HIGH);
#endif
  Serial1.println("PICO_REAL_HIGH");
  delay(200);
  digitalWrite(2, LOW);
#if !defined(ARDUINO_RASPBERRY_PI_PICO_W)
  digitalWrite(25, LOW);
#endif
  Serial1.println("PICO_REAL_LOW");
  Serial1.println(digitalRead(3) ? "PICO_INPUT_HIGH" : "PICO_INPUT_LOW");
  while (Serial1.available()) Serial1.write(Serial1.read());
  delay(200);
}
`

for (const board of ['pi-pico', 'pi-pico-w']) {
  test.describe(`genuine ${board} browser runtime`, () => {
    let project: HardwareProject
    let artifact: RuntimeArtifact

    test.beforeAll(async ({ request }) => {
      test.setTimeout(360_000)
      const created = await request.post('/api/hardware/projects', { data: { name: `${board} dedicated compiler fixture`, board } })
      expect(created.ok(), await created.text()).toBeTruthy()
      project = await created.json()
      const edited = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'edit_firmware', args: { source: firmware }, runtime_token: project.runtime_token } })
      expect(edited.ok(), await edited.text()).toBeTruthy()
      project = await edited.json()
      const compiled = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'compile_firmware', args: {}, runtime_token: project.runtime_token }, timeout: 330_000 })
      expect(compiled.ok(), await compiled.text()).toBeTruthy()
      const result = await compiled.json()
      expect(result.status, result.stderr).toMatch(/compilation_complete|simulation_ready/)
      artifact = result.artifact
      expect(artifact).toBeTruthy()
      expect(artifact.board).toBe(board)
      expect(artifact.format).toBe('bin')
      expect(artifact.encoding).toBe('base64')
      expect(artifact.load_address).toBe(0x10000000)
      expect(artifact.size_bytes).toBeGreaterThan(264)
    })

    test.afterAll(async ({ request }) => {
      if (project) await request.delete(`/api/hardware/projects/${project.id}`)
    })

    test('validates compiler binary and board-specific pin aliases', async ({ page }) => {
      await page.route('**/pico-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pico runtime test</title>' }))
      await page.goto('/pico-runtime-test')
      await page.bringToFront()
      const evidence = await page.evaluate(async ({ project, artifact }) => {
        const path = '/src/hardware/runtime.ts'
        const { validateRuntimeArtifact, boardPin } = await import(path)
        const errors: string[] = []
        for (const change of [{ board: 'arduino-uno' }, { format: 'uf2' }, { encoding: 'hex' }, { load_address: 0 }, { size_bytes: 24 }, { source_revision: -1 }, { program: 'AAAA' }, { program: 'not base64!' }]) {
          try { validateRuntimeArtifact(project, { ...artifact, ...change }); errors.push('accepted') } catch (error) { errors.push(String(error)) }
        }
        const payload = artifact.program ?? artifact.bin!
        const bytes = atob(payload)
        for (const offset of [256, 260]) {
          const corrupted = bytes.slice(0, offset) + '\x00\x00\x00\x00' + bytes.slice(offset + 4)
          try { validateRuntimeArtifact(project, { ...artifact, program: btoa(corrupted), bin: btoa(corrupted) }); errors.push('accepted') } catch (error) { errors.push(String(error)) }
        }
        return { valid: validateRuntimeArtifact(project, artifact) === payload, errors, aliases: ['GP2', 'GPIO2', 'D2', '2', 'A0', 'TX', 'RX', 'GND.1', 'GP30', 'LED_BUILTIN'].map(pin => boardPin(project.board, pin)) }
      }, { project, artifact })
      expect(evidence.valid).toBeTruthy()
      expect(evidence.errors).not.toContain('accepted')
      expect(evidence.aliases).toEqual([2, 2, 2, 2, 26, 0, 1, null, null, board === 'pi-pico' ? 25 : null])
    })

    test('executes real GP2 transitions, UART0 echo and wired button input', async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      await page.route('**/pico-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pico runtime test</title>' }))
      await page.goto('/pico-runtime-test')
      await page.bringToFront()
      const evidence = await page.evaluate(async ({ project, artifact }) => {
        const path = '/src/hardware/runtime.ts'
        const { HardwareRuntime } = await import(path)
        const runtime = new HardwareRuntime(() => {})
        const button = document.createElement('div')
        const boardElement = document.createElement('div') as HTMLElement & { led?: boolean }
        const led = document.createElement('div') as HTMLElement & { value?: boolean }
        const boardId = project.components.find(part => part.type === project.board)!.id
        const wired = {
          ...project,
          components: [...project.components, { id: 'fixture-button', type: 'pushbutton', x: 0, y: 0, rotation: 0, properties: {} }, { id: 'fixture-led', type: 'led', x: 0, y: 0, rotation: 0, properties: {} }],
          wires: [
            { id: 'fixture-input', from: { component: boardId, pin: 'GP3' }, to: { component: 'fixture-button', pin: '1.l' }, color: 'green' },
            { id: 'fixture-ground', from: { component: boardId, pin: 'GND.1' }, to: { component: 'fixture-button', pin: '2.l' }, color: 'black' },
            { id: 'fixture-output', from: { component: boardId, pin: 'GP2' }, to: { component: 'fixture-led', pin: 'A' }, color: 'green' },
            { id: 'fixture-led-ground', from: { component: boardId, pin: 'GND.1' }, to: { component: 'fixture-led', pin: 'C' }, color: 'black' },
          ],
        }
        runtime.registerElement('fixture-button', button)
        runtime.registerElement('fixture-led', led)
        runtime.registerElement(boardId, boardElement)
        const waitFor = async (predicate: () => boolean) => {
          const deadline = performance.now() + 25_000
          while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30))
          return predicate()
        }
        let error: string | null = null
        let echo = false
        let pressed = false
        let released = false
        const ledStates = new Set<boolean>()
        const onboardStates = new Set<boolean>()
        const unsubscribe = runtime.subscribeInstrumentation(() => {
          if (typeof led.value === 'boolean') ledStates.add(led.value)
          if (typeof boardElement.led === 'boolean') onboardStates.add(boardElement.led)
        })
        try {
          await runtime.run(wired, artifact)
          await waitFor(() => runtime.results().serial.includes('PICO_REAL_LOW') && runtime.getSamples('GP2').length >= 6)
          runtime.sendSerial('PICO_UART_ECHO_123\n')
          echo = await waitFor(() => runtime.results().serial.includes('PICO_UART_ECHO_123'))
          button.dispatchEvent(new Event('button-press'))
          pressed = await waitFor(() => runtime.results().serial.includes('PICO_INPUT_LOW'))
          const length = runtime.results().serial.length
          button.dispatchEvent(new Event('button-release'))
          released = await waitFor(() => runtime.results().serial.slice(length).includes('PICO_INPUT_HIGH'))
        } catch (caught) { error = String(caught) }
        const beforeStop = runtime.results()
        const samples = runtime.getSamples('GP2')
        const onboard = runtime.getSamples('GP25')
        const input = runtime.getSamples('GP3')
        const internals = runtime as unknown as { simulator: { rp2040: { core: { PC: number }; uart: { enabled: boolean }[] } } }
        const pc = internals.simulator?.rp2040?.core.PC.toString(16)
        const uart0 = internals.simulator?.rp2040?.uart[0].enabled
        runtime.stop()
        const cycles = runtime.results().cycles
        await new Promise(resolve => setTimeout(resolve, 100))
        const stopped = !runtime.results().running && runtime.results().cycles === cycles
        unsubscribe()
        runtime.dispose()
        return { error, beforeStop, samples, onboard, input, echo, pressed, released, stopped, pc, uart0, ledStates: [...ledStates], onboardStates: [...onboardStates] }
      }, { project, artifact })
      await testInfo.attach('actual-pico-execution', { body: JSON.stringify({ board, artifact: { format: artifact.format, encoding: artifact.encoding, size_bytes: artifact.size_bytes }, ...evidence }, null, 2), contentType: 'application/json' })
      expect(evidence.error, `PC: 0x${evidence.pc}; cycles: ${evidence.beforeStop.cycles}`).toBeNull()
      expect(evidence.beforeStop.running).toBeTruthy()
      expect(evidence.beforeStop.engine).toContain('RP2040Simulator')
      expect(evidence.beforeStop.clock_hz).toBe(125_000_000)
      expect(evidence.beforeStop.serial).toContain('PICO_REAL_SETUP')
      expect(evidence.beforeStop.serial).toContain('PICO_REAL_HIGH')
      expect(evidence.beforeStop.serial).toContain('PICO_REAL_LOW')
      expect(evidence.uart0).toBeTruthy()
      expect(evidence.echo).toBeTruthy()
      expect(evidence.pressed).toBeTruthy()
      expect(evidence.released).toBeTruthy()
      expect(evidence.stopped).toBeTruthy()
      expect(evidence.ledStates.sort()).toEqual([false, true])
      expect(evidence.samples.length).toBeGreaterThanOrEqual(6)
      const transitions = evidence.samples.filter((sample, index, samples) => index === 0 || sample.level !== samples[index - 1].level)
      for (let i = 2; i < transitions.length; i++) {
        expect(transitions[i].time_ms - transitions[i - 1].time_ms).toBeGreaterThanOrEqual(190)
        expect(transitions[i].time_ms - transitions[i - 1].time_ms).toBeLessThanOrEqual(210)
      }
      expect(evidence.input.some(sample => !sample.level)).toBeTruthy()
      expect(evidence.input.at(-1)?.level).toBeTruthy()
      if (board === 'pi-pico') {
        expect(evidence.onboard.length).toBeGreaterThanOrEqual(6)
        expect(evidence.onboardStates.sort()).toEqual([false, true])
      } else {
        expect(evidence.onboardStates).toEqual([])
        expect(evidence.beforeStop.limitations.join(' ')).toMatch(/CYW43.*onboard LED/i)
      }
    })
  })
}
