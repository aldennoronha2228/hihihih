import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`circuit edits retain runnable firmware at ${width}px`, async ({ page, request }) => {
    test.setTimeout(150000)
    await page.setViewportSize({ width, height: 900 })
    const project = await (await request.post('/api/hardware/projects', { data: { name: 'Simulation freshness check', board: 'arduino-uno' } })).json()
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Runtime: Connected')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Compile', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 90000 })
    const edit = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'modify_component', args: { id: 'board', x: 220 }, runtime_token: project.runtime_token } })
    expect(edit.ok()).toBe(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 30000 })
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    const result = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'read_simulation_results', args: {}, runtime_token: project.runtime_token } })
    expect(result.ok()).toBe(true)
    expect((await result.json()).result.cycles).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  })
}
