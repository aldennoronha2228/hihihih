import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`Azure chat choice is persisted and sent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-test', providers: [
      { id: 'groq', label: 'Groq', model: 'groq-test', configured: true },
      { id: 'azure', label: 'Azure', model: 'gpt-6.1-sol', configured: true },
    ] } }))
    await page.route('**/api/chat', route => {
      expect(route.request().postDataJSON().provider).toBe('azure')
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', channel: 'answer', text: 'Azure route verified.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('combobox', { name: 'Chat model' }).selectOption('azure')
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello Azure')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Azure route verified.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Chat model' })).toHaveValue('azure')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Azure missing key shows correct setup field', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-test', providers: [
    { id: 'groq', label: 'Groq', model: 'groq-test', configured: true },
    { id: 'azure', label: 'Azure', model: 'gpt-6.1-sol', configured: false },
  ] } }))
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox', { name: 'Chat model' }).selectOption('azure')
  await expect(page.getByRole('status')).toContainText('AZURE_API_KEY')
})
