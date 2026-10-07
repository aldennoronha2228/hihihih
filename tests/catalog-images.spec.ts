import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`every catalog card has a real preview at ${width}px`, async ({ page, request }) => {
    test.setTimeout(150_000)
    const created = await request.post('/api/hardware/projects', { data: { name: 'Catalog preview verification' } })
    const project = await created.json()
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    if (width < 900) await page.getByRole('button', { name: 'Parts', exact: true }).click()
    const search = page.getByRole('textbox', { name: 'Search components' })
    for (const query of ['ePaper', 'SSD1306', 'LCD1602', 'DC Voltage', 'Raspberry', 'ESP32']) {
      const loaded = page.waitForResponse(response => response.url().includes('/api/hardware/catalog?') && new URL(response.url()).searchParams.get('q') === query)
      await search.fill(query)
      await loaded
      const result = await (await request.get(`/api/hardware/catalog?q=${encodeURIComponent(query)}&limit=200`)).json()
      const expected = [...result.components, ...result.boards].filter((part, index, all) => all.findIndex(other => (other.id || other.type) === (part.id || part.type)) === index)
      await expect(page.locator('.hw-catalog-card')).toHaveCount(expected.length)
      for (const part of expected) {
        const card = page.getByRole('button', { name: new RegExp(`^Add ${part.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) }).first()
        const image = card.locator('img').first()
        await card.scrollIntoViewIfNeeded()
        await expect(image).toBeVisible()
        await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      }
    }
    await search.fill('ePaper')
    await page.screenshot({ path: `test-results/catalog-images-${width}.png` })
  })
}

test('all catalog image assets exist', async ({ request }) => {
  const catalog = await (await request.get('/api/hardware/catalog?limit=200')).json()
  for (const component of catalog.components) {
    if (component.thumbnail?.trim().startsWith('<svg')) continue
    const svg = await request.get(`/component-svgs/${component.id}.svg`)
    if (svg.ok() && svg.headers()['content-type']?.includes('image/svg')) continue
    const png = await request.get(`/component-previews/${component.id}.png`)
    expect(png.ok() && png.headers()['content-type']?.includes('image/png'), `Missing preview for ${component.id}`).toBe(true)
  }
})
