import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`all examples and sample welcome guidance at ${width}px`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: 'View all examples' }).click()
    await expect(page).toHaveURL('/examples')
    await expect(page.locator('article')).toHaveCount(321, { timeout: 20000 })
    await page.getByRole('textbox', { name: 'Search examples' }).fill('Button Control')
    await expect(page.locator('article')).toHaveCount(1)
    await page.getByRole('button', { name: 'Open starter' }).click()
    await expect(page).toHaveURL(/\/project\//)
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    const message = page.getByRole('article', { name: 'WireUp message' })
    await expect(message).toContainText('Welcome to Button Control', { timeout: 15000 })
    await expect(message).toContainText('What is connected')
    await expect(message).toContainText('Compile')
    await expect(message).toContainText('Disconnect power')
    await page.reload()
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(message).toContainText('Welcome to Button Control')
    await page.screenshot({ path: `test-results/sample-guide-${width}.png` })
    await page.goto('/examples', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox', { name: 'Search examples' }).fill('no-such-prototype-xyz')
    await expect(page.getByText('No examples match these filters.')).toBeVisible()
  })
}
