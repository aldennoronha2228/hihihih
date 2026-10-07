import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`WireUp branding and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    await page.route('**/api/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text: 'Hello from WireUp' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' }))
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('WireUp')
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/wireup-favicon.png')
    const visibleLogo = page.locator('img[src="/wireup-logo.png"]:visible')
    await expect(visibleLogo.first()).toBeVisible()
    expect(await visibleLogo.first().evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    if (width < 768) await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(page.getByRole('link', { name: 'WireUp', exact: true })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Close sidebar' }).click()
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('article', { name: 'WireUp message' })).toContainText('Hello from WireUp')
    await expect(page.getByRole('article', { name: 'WireUp message' }).locator('img')).toBeVisible()
    await page.screenshot({ path: `test-results/wireup-${width}.png` })
    await page.goto('/orb')
    await expect(page).toHaveTitle('WireUp')
    await expect(page.locator('canvas')).toBeVisible()
  })
}
