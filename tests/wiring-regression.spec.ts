import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`manual pin wiring renders and survives reload at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 })
    const project = await (await request.post('/api/hardware/projects', { data: { name: 'Manual wiring regression', board: 'arduino-uno' } })).json()
    for (const args of [{ type: 'led', id: 'led1', x: 480, y: 150 }, { type: 'resistor', id: 'r1', x: 390, y: 250 }]) expect((await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'add_component', args } })).ok()).toBe(true)
    await page.goto(`/project/${project.id}`)
    const start = page.getByRole('button', { name: 'Connect board pin 13', exact: true })
    const end = page.getByRole('button', { name: 'Connect led1 pin A', exact: true })
    await expect(start).toBeAttached({ timeout: 30000 })
    await start.click({ force: true })
    await end.click({ force: true })
    await expect(page.locator('.hw-wires path')).toHaveCount(1)
    const updated = await (await request.get(`/api/hardware/projects/${project.id}`)).json()
    expect(updated.wires[0].from).toEqual({ component: 'board', pin: '13' })
    await page.reload()
    await expect(page.locator('.hw-wires path')).toHaveCount(1)
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click()
    await expect(page.locator('.hw-wires path')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Schematic', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Symbol library' })).toBeVisible()
  })
}
