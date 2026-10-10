import { expect, test } from '@playwright/test'

test('Uno LED bar graph follows ten resistor-fed GPIO channels and reattaches after restart', async ({ page, request }) => {
  test.setTimeout(180000)
  const response = await request.post('/api/hardware/projects', { data: { name: 'LED bar GPIO patterns', board: 'arduino-uno' } })
  expect(response.ok(), await response.text()).toBe(true)
  const project = await response.json()
  const command = async (name: string, args: Record<string, unknown>) => {
    const result = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name, args } })
    expect(result.ok(), await result.text()).toBe(true)
    return result.json()
  }
  await command('add_component', { type: 'led-bar-graph', id: 'bar', properties: { color: 'GYR' }, x: 560, y: 120 })
  for (let index = 1; index <= 10; index++) {
    await command('add_component', { type: 'resistor', id: `r${index}`, properties: { value: '470' }, x: 390, y: 100 + index * 35 })
    await command('connect_wire', { from: { component: 'board', pin: String(index + 1) }, to: { component: `r${index}`, pin: '1' } })
    await command('connect_wire', { from: { component: `r${index}`, pin: '2' }, to: { component: 'bar', pin: `A${index}` } })
    await command('connect_wire', { from: { component: 'bar', pin: `C${index}` }, to: { component: 'board', pin: 'GND' } })
  }
  await command('generate_firmware', { source: `const byte pins[] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
void setup() {
  for (byte pin : pins) pinMode(pin, OUTPUT);
}
void loop() {
  for (byte phase = 0; phase < 2; phase++) {
    for (byte i = 0; i < 10; i++) digitalWrite(pins[i], (i + phase) % 2 == 0 ? HIGH : LOW);
    delay(1500);
  }
}
` })
  await page.goto(`/project/${project.id}`)
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 100000 })
  const values = () => page.locator('wokwi-led-bar-graph').evaluate(element => [...(element as HTMLElement & { values: number[] }).values])
  const even = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
  const odd = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
  for (let run = 0; run < 2; run++) {
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(values, { timeout: 15000 }).toEqual(even)
    await expect.poll(values, { timeout: 15000 }).toEqual(odd)
    await expect.poll(values, { timeout: 15000 }).toEqual(even)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
  }
})
