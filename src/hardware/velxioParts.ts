import type { AVRSimulator } from '../../vendor/velxio/frontend/src/simulation/AVRSimulator'
import type { HardwareComponent, HardwareProject } from '../lib/hardware'
import { VelxioBus } from './velxioBus'

export type PeripheralState = {
  type: string; attached: boolean; warning?: string; values: Record<string, unknown>
}
type TraceResult = { arduinoPin: number | null; boardId?: string; railName?: string; crossedActiveDevice: boolean }
export type TraceSnapshot = {
  boards: { id: string; boardKind: string; x: number; y: number }[]
  components: { id: string; metadataId: string; x: number; y: number; rotation: number; properties: Record<string, unknown> }[]
  wires: { id: string; start: { componentId: string; pinName: string }; end: { componentId: string; pinName: string } }[]
}
export type PicoPeripheralSimulator = Pick<AVRSimulator, 'onPinChangeWithTime'> & {
  setADCValue(channel: number, value: number): void
  getADC?: () => { channelValues: number[] } | null
}
type PeripheralSimulator = AVRSimulator | PicoPeripheralSimulator
type Logic = { attachEvents?: (element: HTMLElement, simulator: PeripheralSimulator, resolve: (pin: string) => number | null, id: string) => () => void }
type VendorModule = {
  PartSimulationRegistry: { get(type: string): Logic | undefined }
  traceDetailed(state: TraceSnapshot, id: string, pin: string, depth?: number): TraceResult
  dispatchSensorUpdate(id: string, values: Record<string, number | boolean>): void
  lineGaps(): { componentId?: string; why: string }[]
}
// Eager bundling keeps the upstream store's legacy declarations outside app type checking.
const modules = import.meta.glob<VendorModule>([
  '../../vendor/velxio/frontend/src/simulation/parts/PartSimulationRegistry.ts',
  '../../vendor/velxio/frontend/src/simulation/parts/ComplexParts.ts',
  '../../vendor/velxio/frontend/src/simulation/parts/SensorParts.ts',
  '../../vendor/velxio/frontend/src/simulation/parts/ProtocolParts.ts',
  '../../vendor/velxio/frontend/src/simulation/PinTrace.ts',
  '../../vendor/velxio/frontend/src/simulation/SensorUpdateRegistry.ts',
  '../../vendor/velxio/frontend/src/simulation/line/requestLine.ts',
], { eager: true })
const root = '../../vendor/velxio/frontend/src/simulation/'
const registry = modules[`${root}parts/PartSimulationRegistry.ts`].PartSimulationRegistry
const traceDetailed = modules[`${root}PinTrace.ts`].traceDetailed
const dispatchSensorUpdate = modules[`${root}SensorUpdateRegistry.ts`].dispatchSensorUpdate
const lineGaps = modules[`${root}line/requestLine.ts`].lineGaps
const selected = new Map(['potentiometer', 'slide-potentiometer', 'servo', 'hc-sr04', 'rgb-led', 'dht22', 'photoresistor-sensor', 'ntc-temperature-sensor', 'pir-motion-sensor', 'ssd1306', 'ssd1306-i2c-4pin', 'lcd1602-i2c', 'lcd2004-i2c', 'mpu6050', 'ds1307', 'ds3231', 'bmp280'].map(type => [type, registry.get(type)]))
const oleds = new Set(['ssd1306', 'ssd1306-i2c-4pin', 'lcd1602-i2c', 'lcd2004-i2c', 'mpu6050', 'ds1307', 'ds3231', 'bmp280'])
const picoBoards = new Set(['pi-pico', 'pi-pico-w'])
const boardsSupported = new Set(['arduino-uno', 'arduino-nano', 'arduino-mega', ...picoBoards])
const potentiometers = new Set(['potentiometer', 'slide-potentiometer'])
const analogSensors = new Set(['photoresistor-sensor', 'ntc-temperature-sensor'])
const unoSensors = new Set([...analogSensors, 'pir-motion-sensor'])
const sensorDefaults: Record<string, Record<string, number | boolean>> = {
  'photoresistor-sensor': { lux: 500 },
  'ntc-temperature-sensor': { temperature: 25 },
  'pir-motion-sensor': { trigger: false },
}

export class VelxioParts {
  private snapshot: TraceSnapshot
  private boardId: string | undefined
  private attachments = new Map<string, () => void>()
  private states = new Map<string, PeripheralState>()
  private bus: VelxioBus | null = null

  constructor(private project: HardwareProject, private simulator: PeripheralSimulator, private onReset: () => void = () => this.releaseAll()) {
    const boards = project.components.filter(part => part.type === project.board)
    this.boardId = boards.length === 1 ? boards[0].id : undefined
    const mega = project.board === 'arduino-mega'
    const pico = picoBoards.has(project.board)
    const aliases: Record<string, string> = pico ? {} : {
      TX: '1', TX0: '1', RX: '0', RX0: '0', SDA: mega ? '20' : 'A4', SCL: mega ? '21' : 'A5',
      ...(!mega ? { 'A4.2': 'A4', 'A5.2': 'A5' } : {}), '3.3V': '3V3',
    }
    const pinName = (component: string, pin: string) => boards.some(board => board.id === component)
      ? (aliases[pin] ?? pin) : pin
    for (const part of project.components.filter(part => selected.has(part.type))) {
      this.states.set(part.id, { type: part.type, attached: false, values: { ...part.properties }, warning: 'Peripheral element is not attached.' })
    }
    this.snapshot = {
      boards: boards.map(part => ({ id: part.id, boardKind: part.type === 'pi-pico' ? 'raspberry-pi-pico' : part.type, x: part.x, y: part.y })),
      components: project.components.map(part => ({ id: part.id, metadataId: part.type, x: part.x, y: part.y, rotation: part.rotation, properties: part.properties })),
      wires: project.wires.map(wire => ({ id: wire.id,
        start: { componentId: wire.from.component, pinName: pinName(wire.from.component, wire.from.pin) },
        end: { componentId: wire.to.component, pinName: pinName(wire.to.component, wire.to.pin) },
      })),
    }
  }

  attach(part: HardwareComponent, element: HTMLElement) {
    if (!selected.has(part.type)) return
    this.release(part.id)
    const component = this.snapshot.components.find(component => component.id === part.id)
    if (component) component.properties = { ...part.properties }
    const state: PeripheralState = { type: part.type, attached: false, values: { ...part.properties } }
    this.states.set(part.id, state)
    if (!boardsSupported.has(this.project.board) || !this.boardId) {
      state.warning = 'This peripheral adapter requires exactly one selected Arduino Uno, Nano, Mega, Pico or Pico W.'
      return
    }
    const mega = this.project.board === 'arduino-mega'
    const nano = this.project.board === 'arduino-nano'
    const pico = picoBoards.has(this.project.board)
    const potentiometer = potentiometers.has(part.type)
    const analogSensor = analogSensors.has(part.type)
    const unoSensor = unoSensors.has(part.type)
    const oled = oleds.has(part.type)
    if (unoSensor && (this.project.board !== 'arduino-uno' || !('loadHex' in this.simulator))) {
      state.warning = 'Photoresistor, NTC and PIR sensor integration is enabled only on Arduino Uno.'
      return
    }
    if (oled && (this.project.board !== 'arduino-uno' || !('loadHex' in this.simulator))) {
      state.warning = 'This I2C/SPI peripheral integration is enabled only on Arduino Uno.'
      return
    }
    if (pico && !potentiometer) {
      state.warning = 'The Pico/Pico W adapter enables only rotary and slide potentiometers; servo and HC-SR04 are not enabled.'
      return
    }
    if (pico && !('setADCValue' in this.simulator)) {
      state.warning = 'Pico potentiometers require the RP2040 ADC interface.'
      return
    }
    const analogBase = pico ? 26 : mega ? 54 : 14
    const pinCount = pico ? 29 : mega ? 70 : nano ? 22 : 20
    const resolve = (pin: string) => {
      const result = traceDetailed(this.snapshot, part.id, pin)
      const number = result.arduinoPin
      return result.boardId === this.boardId && !result.crossedActiveDevice && number !== null
        && Number.isInteger(number) && number >= 0 && number < pinCount
        && (potentiometer || !nano || number < 20) ? number : null
    }
    // At the hop limit, only wires and breadboard strips can reach a rail.
    const rail = (pin: string, name: RegExp) => {
      const result = traceDetailed(this.snapshot, part.id, pin, 6)
      return result.boardId === this.boardId && !result.crossedActiveDevice
        && result.arduinoPin === -1 && name.test(result.railName ?? '')
    }
    const supply = pico ? /^3V3$/ : /^5V$/
    if (oled) {
      const fourPin = part.type !== 'ssd1306'
      const explicit = part.properties.protocol
      const spi = !fourPin && (explicit === 'spi' || (explicit !== 'i2c' && resolve('CS') !== null))
      if (fourPin && explicit === 'spi') {
        state.warning = 'SPI is enabled only for the 8-pin SSD1306; this peripheral requires I2C.'
        return
      }
      if (!spi) {
        const address = part.properties.i2cAddress
        const parsed = typeof address === 'number' ? address : typeof address === 'string' && /^(?:0x[0-9a-f]{1,2}|\d{1,3})$/i.test(address.trim()) ? Number(address) : NaN
        if (address !== undefined && (!Number.isInteger(parsed) || parsed < 8 || parsed > 119)) {
          state.warning = 'I2C address must be an explicit 7-bit device address from 0x08 to 0x77.'
          return
        }
      }
      const sda = fourPin ? 'SDA' : 'DATA'
      const scl = fourPin ? 'SCL' : 'CLK'
      const powered = part.type === 'bmp280' ? rail('VCC', /^3V3$/) : part.type === 'ds1307' ? rail('5V', /^5V$/) : fourPin ? rail('VCC', /^(?:5V|3V3)$/)
        : rail('VIN', /^(?:5V|3V3)$/) || rail('3V3', /^3V3$/)
      if (!powered || !rail('GND', /^GND(?:[._]?\d+)?$/)) {
        state.warning = fourPin ? 'Requires VCC wired to Uno 3V3 or 5V and GND to its ground net.'
          : 'Requires VIN wired to Uno 3V3/5V (or 3V3 to Uno 3V3) and GND to its ground net.'
        return
      }
      if (spi) {
        if (resolve('CLK') !== 13 || resolve('DATA') !== 11) {
          state.warning = 'Requires SSD1306 CLK/SCK wired to Uno D13 and DATA/MOSI wired to Uno D11.'
          return
        }
        const cs = resolve('CS')
        const dc = resolve('DC')
        const rst = resolve('RST')
        const resetWired = this.snapshot.wires.some(wire => [wire.start, wire.end].some(pin => pin.componentId === part.id && pin.pinName === 'RST'))
        const controls = [cs, dc, ...(resetWired ? [rst] : [])]
        if (controls.some(pin => pin === null || pin === 11 || pin === 13) || new Set(controls).size !== controls.length) {
          state.warning = 'Requires distinct CS and DC on Uno GPIOs separate from D11/D13; optional RST must use another GPIO when wired.'
          return
        }
      } else if (resolve(sda) !== 18 || resolve(scl) !== 19) {
        state.warning = `Requires ${sda}/SDA wired to Uno A4 and ${scl}/SCL wired to Uno A5; unwired OLED fallback is disabled.`
        return
      }
    } else if (part.type === 'rgb-led') {
      if (!rail('COM', /^GND(?:[._]?\d+)?$/)) {
        state.warning = 'RGB simulation currently supports common cathode only: COM must connect to ground.'
        return
      }
      if (['R', 'G', 'B'].some(pin => resolve(pin) === null)) {
        state.warning = 'Each RGB channel must connect to a digital-capable GPIO; use current-limiting resistors.'
        return
      }
    } else if (!(rail('VCC', supply) || (!unoSensor && rail('V+', supply))) || !rail('GND', /^GND(?:[._]?\d+)?$/)) {
      state.warning = `Requires ${unoSensor ? 'VCC' : 'VCC/V+'} wired to the selected board’s ${pico ? '3V3' : '5V'} rail and GND wired to its ground net.`
      return
    }
    const signal = resolve('PWM') ?? resolve('SIG')
    if (part.type === 'servo' && signal === null) {
      state.warning = 'Requires PWM/SIG wired to a digital-capable GPIO on the selected board; unwired servo fallback is disabled.'
      return
    }
    const analog = analogSensor ? resolve(part.type === 'photoresistor-sensor' ? 'AO' : 'OUT')
      : resolve('SIG') ?? (part.type === 'slide-potentiometer' ? resolve('OUT') : null)
    if (analogSensor && (analog === null || analog < 14 || analog > 19 || !this.simulator.getADC?.())) {
      state.warning = `Requires ${part.type === 'photoresistor-sensor' ? 'AO' : 'OUT'} wired to Uno A0–A5 and an initialized ADC; unwired sensor fallback is disabled.`
      return
    }
    if (part.type === 'pir-motion-sensor' && resolve('OUT') === null) {
      state.warning = 'Requires PIR OUT wired to a digital-capable Uno GPIO.'
      return
    }
    if (potentiometer && (analog === null || analog < analogBase || analog >= pinCount)) {
      state.warning = `Requires ${part.type === 'slide-potentiometer' ? 'SIG/OUT' : 'SIG'} wired to the selected board’s ${pico ? 'GP26–GP28' : `A0–A${mega ? 15 : nano ? 7 : 5}`}.`
      return
    }
    if (part.type === 'hc-sr04' && (resolve('TRIG') === null || resolve('ECHO') === null || resolve('TRIG') === resolve('ECHO'))) {
      state.warning = 'Requires distinct TRIG and ECHO connections to digital-capable GPIO on the selected board.'
      return
    }
    if (part.type === 'dht22' && resolve('SDA') === null && resolve('DATA') === null) {
      state.warning = 'Requires DHT22 SDA/DATA connected to a digital-capable GPIO.'
      return
    }
    const attach = selected.get(part.type)?.attachEvents
    if (!attach) { state.warning = 'Upstream peripheral implementation is unavailable.'; return }
    Object.assign(element, sensorDefaults[part.type], part.properties)
    const previous = this.simulator.onPinChangeWithTime
    if (oled && !this.bus) this.bus = new VelxioBus(this.snapshot, this.boardId, this.simulator as AVRSimulator, this.onReset)
    // These sensor handlers use element values and DOM property mirrors, not store reads.
    const sensorPins = part.type === 'photoresistor-sensor' ? new Set(['AO', 'DO']) : new Set(['OUT'])
    const handlerResolve = unoSensor ? (pin: string) => sensorPins.has(pin) ? resolve(pin) : null : resolve
    const cleanup = oled ? this.bus!.attach(() => attach(element, this.simulator, handlerResolve, part.id))
      : attach(element, this.simulator, handlerResolve, part.id)
    const upstream = this.simulator.onPinChangeWithTime
    const chained: typeof previous = upstream !== previous ? (pin, level, time) => {
      previous?.(pin, level, time)
      upstream?.(pin, level, time)
    } : previous
    this.simulator.onPinChangeWithTime = chained
    state.attached = true
    const input = () => { state.values.value = (element as HTMLElement & { value?: unknown }).value }
    if (potentiometer) element.addEventListener('input', input)
    this.attachments.set(part.id, () => {
      cleanup()
      element.removeEventListener('input', input)
      if (upstream !== previous && (this.simulator.onPinChangeWithTime === chained || this.simulator.onPinChangeWithTime === null)) this.simulator.onPinChangeWithTime = previous
      if ((potentiometer || analogSensor) && analog !== null) {
        if (pico && 'setADCValue' in this.simulator) this.simulator.setADCValue(analog - analogBase, 0)
        else {
          const adc = this.simulator.getADC?.()
          if (adc) adc.channelValues[analog - analogBase] = 0
        }
      }
      if (part.type === 'pir-motion-sensor' && 'loadHex' in this.simulator) {
        const output = resolve('OUT')
        if (output !== null) this.simulator.setPinState(output, false)
      }
      state.attached = false
    })
    this.update(part.id, part.properties, element)
  }

  update(id: string, properties: Record<string, unknown>, element?: HTMLElement) {
    const state = this.states.get(id)
    const component = this.snapshot.components.find(component => component.id === id)
    if (component) component.properties = { ...properties }
    if (!state?.attached) return
    if (oleds.has(state.type) && ['i2cAddress', 'protocol'].some(key => state.values[key] !== properties[key])) {
      const part = this.project.components.find(part => part.id === id)
      if (part && element) this.attach({ ...part, properties }, element)
      else this.release(id)
      return
    }
    const currentProperties = { ...sensorDefaults[state.type], ...properties }
    state.values = { ...state.values, ...currentProperties }
    if (element) Object.assign(element, currentProperties)
    const values: Record<string, number | boolean> = {}
    for (const [key, value] of Object.entries(currentProperties)) {
      if (typeof value === 'boolean') values[key] = value
      else if ((typeof value === 'number' || typeof value === 'string') && String(value).trim() && Number.isFinite(Number(value))) values[key] = Number(value)
    }
    dispatchSensorUpdate(id, values)
    if (potentiometers.has(state.type)) element?.dispatchEvent(new Event('input'))
  }

  release(id: string) {
    this.attachments.get(id)?.()
    this.attachments.delete(id)
    const state = this.states.get(id)
    if (state && oleds.has(state.type) && !state.attached) state.warning = undefined
    if (this.bus && ![...this.states.values()].some(state => state.attached && oleds.has(state.type))) {
      this.bus.dispose()
      this.bus = null
    }
  }
  releaseAll() {
    for (const id of [...this.attachments.keys()].reverse()) this.release(id)
    this.bus?.dispose()
    this.bus = null
  }
  results(elements: Map<string, HTMLElement>) {
    for (const [id, state] of this.states) {
      if (state.attached && oleds.has(state.type)) state.warning = this.bus?.warning(id)
      if (state.attached && state.type === 'rgb-led') {
        const element = elements.get(id) as HTMLElement & {ledRed?:number;ledGreen?:number;ledBlue?:number} | undefined
        state.values = { ...state.values, ledRed: element?.ledRed, ledGreen: element?.ledGreen, ledBlue: element?.ledBlue }
      }
      if (state.attached && state.type === 'servo') state.values.angle = (elements.get(id) as HTMLElement & { angle?: number } | undefined)?.angle
      const gap = lineGaps().find(gap => gap.componentId === id)
      if (gap) { state.warning = gap.why; state.attached = false }
    }
    return Object.fromEntries([...this.states].map(([id, state]) => [id, { ...state, values: { ...state.values } }]))
  }
}
