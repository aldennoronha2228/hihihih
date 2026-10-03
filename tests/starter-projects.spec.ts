import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`home starter opens a real independent project at ${width}px`, async ({ page, request }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const samples = page.getByRole('region', { name: 'Starter projects' })
    await expect(samples.getByRole('button')).toHaveCount(6, { timeout: 15000 })
    const catalog = await (await request.get('/api/hardware/samples')).json()
    const starter = catalog.samples.find((sample: { id: string }) => sample.id === 'button-led')
    await samples.getByRole('button', { name: `Open sample ${starter.title}`, exact: true }).click()
    await expect(page).toHaveURL(/\/project\//)
    const id = page.url().split('/').pop()!
    const project = await (await request.get(`/api/hardware/projects/${id}`)).json()
    expect(project.board).toBe('arduino-uno')
    expect(project.components.length).toBeGreaterThan(1)
    expect(project.wires.length).toBeGreaterThan(0)
    expect(project.firmware.source).toContain('void setup')
    if (width < 900) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Select board', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sketch', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Firmware source' })).toHaveValue(project.firmware.source)
    await page.keyboard.press('Escape')
    const copied = await (await request.post('/api/hardware/samples/button-led/open')).json()
    expect(copied.id).not.toBe(project.id)
    expect(copied.wires).toEqual(project.wires)
  })
}

test('all starter templates open with independent wiring and firmware', async ({ request }) => {
  const catalog = await (await request.get('/api/hardware/samples')).json()
  expect(catalog.samples).toHaveLength(6)
  for (const sample of catalog.samples) {
    const response = await request.post(`/api/hardware/samples/${sample.id}/open`)
    expect(response.ok(), sample.id).toBe(true)
    const project = await response.json()
    expect(project.id).toBeTruthy()
    expect(project.firmware.source).toBeTruthy()
    expect(project.components.some((component: { id: string }) => component.id === 'board')).toBe(true)
  }
})
