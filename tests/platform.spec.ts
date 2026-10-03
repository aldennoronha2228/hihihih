import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`home prompt creates a prototype and starts scoped agent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const calls: object[] = []
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    await page.route('**/api/chat', route => {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', channel: 'thinking', text: 'Temporary provider reasoning' }) + '\n' + JSON.stringify({ type: 'text', channel: 'answer', text: 'Your prototype workspace is open.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible()
    await expect(page.getByText('Hardware projects', { exact: true })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Describe your hardware prototype' }).fill('Build a blinking LED circuit')
    await page.getByRole('button', { name: 'Build prototype' }).click()
    await expect(page).toHaveURL(/\/project\//)
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(page.getByText('Your prototype workspace is open.', { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(calls.length).toBe(1)
    expect(calls[0]).toMatchObject({ project_id: expect.any(String), runtime_token: expect.any(String), messages: [{ role: 'user', content: 'Build a blinking LED circuit' }] })
    await expect(page.getByText('Temporary provider reasoning')).toHaveCount(0)
    await page.screenshot({ path: `test-results/platform-${width}.png`, timeout: 15000 })
  })
}
