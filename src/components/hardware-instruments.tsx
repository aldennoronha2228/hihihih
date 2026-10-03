import { useEffect, useRef, useState } from 'react'
import type { DigitalSample, HardwareRuntime, InstrumentationSnapshot, RuntimeResults } from '../hardware/runtime'
import type { AnalogSolveResult } from '../hardware/spice'
import './hardware-instruments.css'

export type HardwareInstrumentsProps = {
  runtime: HardwareRuntime | null
  results: RuntimeResults | null
  analogResult?: AnalogSolveResult | null
}
const COLORS = ['#60dfb6', '#7cbcff', '#f4cf79', '#d6a2ff']
const LEFT = 80
const WIDTH = 900
const PLOT = WIDTH - LEFT - 20

function digitalTrace(samples: DigitalSample[], pin: string, start: number, end: number, row: number): string {
  const channel = samples.filter(sample => sample.pin === pin && sample.time_ms <= end).sort((a, b) => a.time_ms - b.time_ms)
  const x = (time: number) => LEFT + (time - start) / (end - start) * PLOT
  const y = (level: boolean) => row + (level ? 12 : 40)
  let previous: DigitalSample | undefined
  let path = ''
  for (const sample of channel) {
    if (sample.time_ms < start) { previous = sample; continue }
    if (!path && previous) path = `M${LEFT},${y(previous.level)}`
    if (!path) path = `M${x(sample.time_ms)},${y(sample.level)}`
    else path += ` H${x(sample.time_ms)} V${y(sample.level)}`
    previous = sample
  }
  if (!path && previous) path = `M${LEFT},${y(previous.level)}`
  return path ? `${path} H${x(end)}` : ''
}

function labelPin(pin: string, board: string | null | undefined) {
  return board === 'pi-pico' && ['GP23', 'GP24', 'GP25', 'GP29'].includes(pin) ? `${pin}${pin === 'GP25' ? ' (LED)' : ' (internal)'}` : pin
}

export function HardwareInstruments({ runtime, results, analogResult }: HardwareInstrumentsProps) {
  const [live, setLive] = useState<InstrumentationSnapshot | null>(null)
  const latest = useRef<InstrumentationSnapshot | null>(null)
  const [frozen, setFrozen] = useState<{ digital: InstrumentationSnapshot | null; analog: AnalogSolveResult | null } | null>(null)
  const [selected, setSelected] = useState(['D13'])
  const [scale, setScale] = useState(100)
  const [mode, setMode] = useState<'digital' | 'analog'>('digital')
  const [node, setNode] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)

  useEffect(() => {
    if (!runtime) return
    return runtime.subscribeInstrumentation(snapshot => { latest.current = snapshot; setLive(snapshot) })
  }, [runtime])

  const snapshot = frozen ? frozen.digital : runtime ? live : null
  const analog = frozen ? frozen.analog : analogResult
  const board = snapshot?.board ?? results?.board
  const available = snapshot?.channels.map(channel => channel.pin) ?? Object.keys(results?.pins ?? {})
  const channels = selected.map(pin => available.includes(pin) ? pin : board === 'pi-pico' ? 'GP25' : 'D13').filter((pin, index, all) => all.indexOf(pin) === index)
  const samples = snapshot?.samples ?? results?.samples ?? []
  const time = snapshot?.simulated_ms ?? results?.simulated_ms ?? 0
  const span = scale * 10
  const end = Math.max(span, time)
  const start = end - span
  const height = channels.length * 60 + 42
  const nodes = analog?.ok ? Object.keys(analog.nodeVoltages) : []
  const chosenNode = nodes.includes(node) ? node : nodes[0] ?? ''
  const volts = analog?.nodeVoltages[chosenNode] ?? []
  const analogEnd = Math.max(span, (analog?.time.at(-1) ?? 0) * 1000)
  const analogStart = analogEnd - span
  const analogPoints = analog?.ok && analog.analysis === 'transient' ? analog.time.flatMap((seconds, index) => {
    const value = volts[index]
    return Number.isFinite(seconds) && Number.isFinite(value) && seconds * 1000 >= analogStart && seconds * 1000 <= analogEnd ? [{ time: seconds * 1000, value }] : []
  }) : []
  let minimum = Infinity
  let maximum = -Infinity
  for (const point of analogPoints) { minimum = Math.min(minimum, point.value); maximum = Math.max(maximum, point.value) }
  if (!analogPoints.length) { minimum = 0; maximum = 1 }
  const range = maximum - minimum || 1
  const analogPath = analogPoints.map((point, index) => `${index ? 'L' : 'M'}${LEFT + (point.time - analogStart) / span * PLOT},${170 - (point.value - minimum) / range * 140}`).join(' ')
  const cursorTime = cursor === null ? null : (mode === 'digital' ? start : analogStart) + cursor * span
  const cursorSample = cursorTime === null ? undefined : samples.filter(sample => sample.pin === channels[0] && sample.time_ms <= cursorTime).at(-1)

  return <section className="hardware-instruments" aria-label="Hardware instruments">
    <header className="instrument-header">
      <div><h3>Oscilloscope / Logic analyzer</h3><p>Actual emulator edges · optional ngspice voltage samples</p></div>
      <span className={`instrument-status ${results?.running ? 'is-running' : ''}`}>{frozen ? 'View paused' : results?.running ? 'Live' : 'Stopped'}</span>
    </header>
    <div className="instrument-toolbar">
      <label>Instrument<select value={mode} onChange={event => { setMode(event.target.value as 'digital' | 'analog'); setCursor(null) }}><option value="digital">Digital logic</option><option value="analog">Analog voltage</option></select></label>
      <label>Time / division<select value={scale} onChange={event => setScale(Number(event.target.value))}>{[0.001, 0.01, 0.1, 1, 10, 100, 1000].map(value => <option key={value} value={value}>{value < 1 ? `${value * 1000} µs` : `${value} ms`}</option>)}</select></label>
      <button type="button" aria-pressed={!!frozen} onClick={() => setFrozen(frozen ? null : { digital: latest.current, analog: analogResult ?? null })}>{frozen ? 'Resume view' : 'Pause view'}</button>
      <button type="button" disabled={!runtime} onClick={() => { runtime?.clearSamples(); setFrozen(null); setCursor(null) }}>Clear digital capture</button>
    </div>
    {mode === 'digital' ? <>
      <div className="instrument-channels">{channels.map((pin, index) => <div className="instrument-channel" key={index} style={{ color: COLORS[index % COLORS.length] }}>
        <label>CH{index + 1}<select aria-label={`Channel ${index + 1} pin`} value={pin} onChange={event => setSelected(channels.map((current, channel) => channel === index ? event.target.value : current))}>
          {!available.includes(pin) && <option value={pin}>{pin}</option>}{available.map(option => <option key={option} value={option}>{labelPin(option, board)}</option>)}
        </select></label>
        <span>{(snapshot?.channels.find(channel => channel.pin === pin)?.level ?? results?.pins[pin]?.level) === true ? 'HIGH' : (snapshot?.channels.find(channel => channel.pin === pin)?.level ?? results?.pins[pin]?.level) === false ? 'LOW' : 'Unknown'}</span>
        {channels.length > 1 && <button type="button" aria-label={`Remove channel ${index + 1}`} onClick={() => setSelected(channels.filter((_, channel) => channel !== index))}>×</button>}
      </div>)}<button type="button" disabled={channels.length >= 4 || !available.some(pin => !channels.includes(pin))} onClick={() => { const next = available.find(pin => !channels.includes(pin)); if (next) setSelected([...channels, next]) }}>+ Channel</button></div>
      <svg className="instrument-plot" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Captured digital pin transitions" onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * WIDTH - LEFT) / PLOT))) }} onPointerLeave={() => setCursor(null)}>
        {Array.from({ length: 11 }, (_, index) => <g key={index}><line className="instrument-grid" x1={LEFT + index * PLOT / 10} x2={LEFT + index * PLOT / 10} y1={0} y2={height - 25} /><text x={LEFT + index * PLOT / 10} y={height - 6} textAnchor="middle">{(start + index * scale).toFixed(scale < 0.1 ? 3 : 1)}</text></g>)}
        {channels.map((pin, index) => <g key={pin}><text x={10} y={index * 60 + 30} fill={COLORS[index % COLORS.length]}>{pin}</text><line className="instrument-grid" x1={LEFT} x2={WIDTH - 20} y1={index * 60 + 40} y2={index * 60 + 40} /><path className="instrument-digital-trace" stroke={COLORS[index % COLORS.length]} d={digitalTrace(samples, pin, start, end, index * 60)} /></g>)}
        {cursor !== null && <line className="instrument-cursor" x1={LEFT + cursor * PLOT} x2={LEFT + cursor * PLOT} y1={0} y2={height - 25} />}
      </svg>
      <div className="instrument-caption"><span>{samples.length} retained edges / {snapshot?.capacity ?? results?.sample_capacity ?? 8192} · {snapshot?.dropped_samples ?? results?.dropped_samples ?? 0} overwritten · time in ms</span><span>{cursorTime === null ? 'Hover to inspect' : `${cursorTime.toFixed(4)} ms · ${channels[0]} ${cursorSample ? cursorSample.level ? 'HIGH' : 'LOW' : 'unknown'}`}</span></div>
      {!samples.length && <p className="instrument-notice">No captured digital edges. Run compiled firmware and select a pin it actually changes. Unknown history is not drawn.</p>}
    </> : <>
      <div className="instrument-channels"><label>Voltage node<select aria-label="Analog voltage node" value={chosenNode} disabled={!nodes.length} onChange={event => setNode(event.target.value)}>{nodes.map(name => <option key={name} value={name}>{name}</option>)}</select></label><span>ngspice · separate solver time axis</span></div>
      {analog?.ok && analog.analysis === 'dc' ? <p className="instrument-reading">{chosenNode}: {Number.isFinite(volts[0]) ? `${volts[0].toPrecision(6)} V` : 'No measurement'} <small>DC operating point · no time trace</small></p> : <svg className="instrument-plot" viewBox={`0 0 ${WIDTH} 210`} role="img" aria-label="Actual ngspice transient voltage samples">
        {Array.from({ length: 11 }, (_, index) => <g key={index}><line className="instrument-grid" x1={LEFT + index * PLOT / 10} x2={LEFT + index * PLOT / 10} y1={20} y2={180} /><text x={LEFT + index * PLOT / 10} y={202} textAnchor="middle">{(analogStart + index * scale).toFixed(scale < 0.1 ? 3 : 1)}</text></g>)}
        <text x={8} y={30}>{maximum.toPrecision(4)} V</text><text x={8} y={172}>{minimum.toPrecision(4)} V</text><path className="instrument-analog-trace" d={analogPath} />
      </svg>}
      {!analog && <p className="instrument-notice">No SPICE result supplied. Solve an analog circuit to display actual voltage data.</p>}
      {analog && !analog.ok && <div className="instrument-notice" role="alert">{analog.diagnostics.map((diagnostic, index) => <p key={index}>{diagnostic.message}</p>)}</div>}
      {analog?.ok && analog.analysis === 'transient' && !analogPoints.length && <p className="instrument-notice">No measured samples in this time window.</p>}
      {analog && <p className="instrument-caption">SPICE project revision {analog.projectRevision} · not coupled to MCU ADC/GPIO · time in ms</p>}
    </>}
    <p className="instrument-footnote">Pause freezes this view, not firmware or capture. Digital levels are not measured voltages; no synthetic waveforms are generated.</p>
  </section>
}

export default HardwareInstruments
