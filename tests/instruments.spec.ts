import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`real logic capture and instrument controls at ${width}px`, async ({ page, request }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width, height: 900 })
    const response = await request.post('/api/hardware/projects', { data: { name: 'Instrument verification', board: 'arduino-uno' } })
    const project = await response.json()
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Runtime: Connected')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Compile', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 90000 })
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('button', { name: 'Oscilloscope', exact: true }).click()
    const plot = page.getByRole('img', { name: 'Captured digital pin transitions' })
    await expect(plot).toBeVisible()
    await expect.poll(() => page.locator('.instrument-digital-trace').first().getAttribute('d'), { timeout: 15000 }).not.toBe('')
    await page.getByRole('button', { name: 'Pause view' }).click()
    await expect(page.getByRole('button', { name: 'Resume view' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume view' }).click()
    await page.getByRole('button', { name: '+ Channel', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Channel 2 pin' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Channel 2 pin' }).selectOption('D12')
    await page.getByRole('button', { name: 'Remove channel 2' }).click()
    await page.getByRole('button', { name: 'Clear digital capture' }).click()
    await page.screenshot({ path: `test-results/instrument-${width}.png` })
  })
}
