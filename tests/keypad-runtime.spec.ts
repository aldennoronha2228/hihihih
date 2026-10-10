import { expect, test } from '@playwright/test'
import type { HardwareProject } from '../src/lib/hardware'
import type { RuntimeArtifact } from '../src/hardware/runtime'

let project: HardwareProject
let artifact: RuntimeArtifact

// Both scan directions run in the guest; no Keypad.h dependency is required.
const source = `
const byte rows[4] = {2,3,4,5};
const byte cols[4] = {6,7,8,9};
const char legends[4][4] = {{'1','2','3','A'},{'4','5','6','B'},{'7','8','9','C'},{'*','0','#','D'}};
bool reverseScan = false;
unsigned int previous = 0;
unsigned int scan() {
  const byte *inputs = reverseScan ? cols : rows;
  const byte *outputs = reverseScan ? rows : cols;
  unsigned int mask = 0;
  for (byte i=0;i<4;i++) { pinMode(inputs[i],INPUT_PULLUP); pinMode(outputs[i],INPUT); digitalWrite(outputs[i],LOW); }
  for (byte i=0;i<4;i++) {
    pinMode(outputs[i],OUTPUT);
    digitalWrite(outputs[i],LOW);
    delayMicroseconds(20);
    for (byte j=0;j<4;j++) if (digitalRead(inputs[j]) == LOW) {
      byte row = reverseScan ? i : j;
      byte col = reverseScan ? j : i;
      mask |= (1U << (row*4+col));
    }
    pinMode(outputs[i],INPUT);
  }
  return mask;
}
void setup() { Serial.begin(9600); Serial.println("READY"); }
void loop() {
  if (Serial.available()) {
    reverseScan = Serial.read() == 'R';
    previous = 0;
    Serial.println(reverseScan ? "MODE:ROW" : "MODE:COL");
  }
  unsigned int current = scan();
  for (byte i=0;i<16;i++) if ((current ^ previous) & (1U << i)) {
    Serial.print(current & (1U << i) ? "KEY:" : "UP:");
    Serial.println(legends[i/4][i%4]);
  }
  previous = current;
  delay(10);
}
`

test.beforeAll(async ({ request }) => {
  test.setTimeout(150_000)
  const created = await request.post('/api/hardware/projects', { data: { name: 'Passive matrix keypad', board: 'arduino-uno' } })
  expect(created.ok(), await created.text()).toBe(true)
  project = await created.json()
  const command = async (name: string, args: Record<string, unknown>) => {
    const response = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name, args }, timeout: 120_000 })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await command('add_component', { type: 'membrane-keypad', id: 'keypad', x: 430, y: 150 })
  for (const [index, pin] of ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].entries()) {
    await command('connect_wire', { from: { component: 'board', pin: String(index + 2) }, to: { component: 'keypad', pin } })
  }
  await command('generate_firmware', { source })
  const compiled = await command('compile_firmware', {})
  expect(compiled.status, JSON.stringify(compiled)).toBe('simulation_ready')
  artifact = compiled.artifact
  const saved = await request.get(`/api/hardware/projects/${project.id}`)
  expect(saved.ok(), await saved.text()).toBe(true)
  project = await saved.json()
})

for (const direction of ['columns', 'rows']) {
  test(`Uno firmware scans every keypad key via ${direction} and releases/stops cleanly`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.route('**/keypad-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Keypad runtime test</title>' }))
    await page.goto('/keypad-runtime-test')
    const evidence = await page.evaluate(async ({ project, artifact, direction }) => {
      const runtimePath = '/src/hardware/runtime.ts'
      const elementPath = '/node_modules/@wokwi/elements/dist/esm/membrane-keypad-element.js'
      const { HardwareRuntime } = await import(runtimePath)
      await import(elementPath)
      const runtime = new HardwareRuntime(() => {})
      const element = document.createElement('wokwi-membrane-keypad') as HTMLElement & {
        pinInfo: { name: string }[]; updateComplete: Promise<unknown>
        keyStrokeDown(key: string): void; keyStrokeUp(key: string): void
      }
      document.body.append(element)
      await element.updateComplete
      const pins = element.pinInfo.map(pin => pin.name)
      runtime.registerElement('keypad', element)
      const waitFor = async (predicate: () => boolean) => {
        const deadline = performance.now() + 10_000
        while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
        if (!predicate()) throw new Error(`Firmware timeout: ${runtime.results().serial}`)
      }
      const after = (offset: number) => runtime.results().serial.slice(offset)
      const lines = () => runtime.results().serial.split(/\r?\n/).filter(line => /^(KEY|UP):/.test(line))
      try {
        await runtime.run(project, artifact)
        await waitFor(() => runtime.results().serial.includes('READY'))
        if (direction === 'rows') {
          runtime.sendSerial('R')
          await waitFor(() => runtime.results().serial.includes('MODE:ROW'))
        }
        const attached = runtime.results().peripherals?.keypad
        const idle = lines()
        for (const key of '123A456B789C*0#D') {
          const start = runtime.results().serial.length
          element.keyStrokeDown(key)
          await waitFor(() => after(start).includes(`KEY:${key}\r\n`))
          element.keyStrokeUp(key)
          await waitFor(() => after(start).includes(`UP:${key}\r\n`))
        }
        const scanned = lines()
        element.keyStrokeDown('5')
        const heldStart = runtime.results().serial.length
        await waitFor(() => after(heldStart).includes('KEY:5\r\n'))
        // Detaching a held membrane must stop before upstream leaves driven pads behind.
        runtime.registerElement('keypad', null)
        const detached = runtime.results()
        runtime.registerElement('keypad', element)
        element.keyStrokeDown('D')
        await runtime.run(project, artifact)
        await waitFor(() => runtime.results().serial.includes('READY'))
        runtime.sendSerial('C')
        await waitFor(() => runtime.results().serial.includes('MODE:COL'))
        const restartIdle = lines()
        const restartStart = runtime.results().serial.length
        element.keyStrokeDown('5')
        await waitFor(() => after(restartStart).includes('KEY:5\r\n'))
        element.keyStrokeUp('5')
        await waitFor(() => after(restartStart).includes('UP:5\r\n'))
        const restartLines = lines()
        element.keyStrokeDown('A')
        runtime.stop()
        const stopped = runtime.results()
        element.keyStrokeDown('B')
        element.keyStrokeUp('B')
        await new Promise(resolve => setTimeout(resolve, 200))
        const stoppedAfterEvents = runtime.results()
        await runtime.run(project, artifact)
        await waitFor(() => runtime.results().serial.includes('READY'))
        runtime.updateComponentProperties('keypad', { columns: '3' })
        const resized = runtime.results()
        return { resized: { running: resized.running, attached: resized.peripherals?.keypad.attached }, pins, attached, idle, scanned, detached: { running: detached.running, attached: detached.peripherals?.keypad.attached }, restartIdle, restartLines, stopped: { running: stopped.running, attached: stopped.peripherals?.keypad.attached }, stoppedUnchanged: stopped.serial === stoppedAfterEvents.serial && stopped.cycles === stoppedAfterEvents.cycles }
      } finally { runtime.dispose(); element.remove() }
    }, { project, artifact, direction })
    expect(evidence.pins).toEqual(['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'])
    expect(evidence.attached?.attached).toBe(true)
    expect(evidence.attached?.warning).toBeUndefined()
    expect(evidence.idle).toEqual([])
    expect(evidence.scanned).toEqual([...'123A456B789C*0#D'].flatMap(key => [`KEY:${key}`, `UP:${key}`]))
    expect(evidence.detached).toEqual({ running: false, attached: false })
    expect(evidence.restartIdle).toEqual([])
    expect(evidence.restartLines).toEqual(['KEY:5', 'UP:5'])
    expect(evidence.stopped).toEqual({ running: false, attached: false })
    expect(evidence.stoppedUnchanged).toBe(true)
    expect(evidence.resized).toEqual({ running: false, attached: false })
  })
}

test('keypad adapter refuses incomplete, duplicate, rail, Serial and non-Uno wiring', async ({ page }) => {
  await page.route('**/keypad-runtime-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.goto('/keypad-runtime-test')
  const evidence = await page.evaluate(async project => {
    const partsPath = '/src/hardware/velxioParts.ts'
    const simPath = '/vendor/velxio/frontend/src/simulation/AVRSimulator.ts'
    const pinsPath = '/vendor/velxio/frontend/src/simulation/PinManager.ts'
    const { VelxioParts } = await import(partsPath)
    const { AVRSimulator } = await import(simPath)
    const { PinManager } = await import(pinsPath)
    const variants = ['missing', 'duplicate', 'rail', 'serial', 'analog', 'nano', 'three-columns']
    return variants.map(variant => {
      const snapshot = structuredClone(project)
      if (variant === 'missing') snapshot.wires.pop()
      else if (variant === 'nano') {
        snapshot.board = 'arduino-nano'
        snapshot.components.find(part => part.id === 'board')!.type = 'arduino-nano'
      } else if (variant === 'three-columns') snapshot.components.find(part => part.id === 'keypad')!.properties.columns = '3'
      else snapshot.wires.find(wire => wire.to.pin === 'C4')!.from.pin = variant === 'duplicate' ? '2' : variant === 'rail' ? '5V' : variant === 'serial' ? '0' : 'A0'
      const parts = new VelxioParts(snapshot, new AVRSimulator(new PinManager(), 'uno'))
      const element = document.createElement('div')
      parts.attach(snapshot.components.find(part => part.id === 'keypad')!, element)
      const result = parts.results(new Map([['keypad', element]])).keypad
      parts.releaseAll()
      return { variant, attached: result.attached, warning: result.warning }
    })
  }, project)
  for (const result of evidence) {
    expect(result.attached, result.variant).toBe(false)
    expect(result.warning, result.variant).toMatch(/distinct|Uno|4×4/)
  }
})
