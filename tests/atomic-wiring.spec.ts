import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`actual atomic wiring updates circuit and schematic at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 })
    const project = await (await request.post('/api/hardware/projects', { data: { name: 'Atomic wiring browser test', board: 'arduino-uno' } })).json()
    for (const args of [{ type: 'led', id: 'led1' }, { type: 'resistor', id: 'r1', properties: { value: '220' } }]) expect((await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'add_component', args } })).ok()).toBe(true)
    const result = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'wire_circuit', args: { batch: [
      { from: { component: 'board', pin: '13' }, to: { component: 'r1', pin: '1' } },
      { from: { component: 'r1', pin: '2' }, to: { component: 'led1', pin: 'A' } },
      { from: { component: 'led1', pin: 'C' }, to: { component: 'board', pin: 'GND.1' } },
    ] } } })
    expect(result.ok()).toBe(true)
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Select led1', exact: true })).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.hw-wires path')).toHaveCount(3)
    await page.getByRole('tab', { name: 'Schematic', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Symbol library' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Schematic', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect((await (await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'validate_circuit', args: {} } })).json()).valid).toBe(true)
  })
}
