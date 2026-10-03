import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`failed project never shows legacy creation UI at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    let attempts = 0
    await page.route('**/api/hardware/catalog**', route => route.fulfill({ json: { components: [], boards: [] } }))
    await page.route('**/api/hardware/projects/broken', route => {
      attempts++
      return route.fulfill({ status: 502, json: { detail: 'The hardware backend is unavailable.' } })
    })
    await page.goto('/project/broken', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Unable to open this project' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('hardware backend is unavailable')
    await expect(page.getByRole('button', { name: 'New Uno project' })).toHaveCount(0)
    await expect(page.getByText('Build something real.', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0)
    const previousAttempts = attempts
    await page.getByRole('button', { name: 'Retry loading' }).click()
    await expect.poll(() => attempts).toBeGreaterThan(previousAttempts)
    await expect(page.getByRole('heading', { name: 'Unable to open this project' })).toBeVisible()
    await page.screenshot({ path: `test-results/workspace-load-error-${width}.png` })
    await page.getByRole('link', { name: 'Back to home', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible()
  })
}
