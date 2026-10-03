import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`new canvas starts empty and additional boards can be placed at ${width}px`, async ({ page, request }) => {
    test.setTimeout(120_000)
    const created = await request.post('/api/hardware/projects', { data: { name: 'Board placement verification' } })
    const project = await created.json()
    expect(project.board).toBe('unselected')
    expect(project.components).toEqual([])
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel('Circuit canvas', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Board not selected', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Compile', exact: true })).toBeDisabled()
    if (width < 900) await page.getByRole('button', { name: 'Parts', exact: true }).click()
    const search = page.getByRole('textbox', { name: 'Search components' })
    for (const [query, id, name] of [
      ['ESP32 DevKit V1', 'esp32-devkit-v1', 'ESP32 DevKit V1'],
      ['Raspberry Pi Pico', 'pi-pico', 'Raspberry Pi Pico'],
      ['Raspberry Pi 4', 'raspberry-pi-4', 'Raspberry Pi 4'],
    ]) {
      await search.fill(query)
      const button = page.getByRole('button', { name: `Add ${name} boards`, exact: true })
      await expect(button).toBeEnabled({ timeout: 10000 })
      await button.click()
      await expect.poll(async () => (await (await request.get(`/api/hardware/projects/${project.id}`)).json()).board).toBe(id)
      if (width < 900) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Select board', exact: true })).toBeVisible()
      expect(await page.locator('.hw-part-element').evaluate(element => element.children.length)).toBeGreaterThan(0)
      if (width < 900) await page.getByRole('button', { name: 'Parts', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: 'Compile', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    await page.screenshot({ path: `test-results/board-selection-${width}.png` })
  })
}
