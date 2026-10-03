import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`Bedrock selection routes chat and persists at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-test', providers: [
      { id: 'groq', label: 'Groq', model: 'groq-test', configured: true },
      { id: 'nvidia', label: 'NVIDIA', model: 'glm-test', configured: true },
      { id: 'bedrock', label: 'Amazon Bedrock', model: 'moonshotai.kimi-k2.5', configured: true },
    ] } }))
    await page.route('**/api/chat', route => {
      expect(route.request().postDataJSON().provider).toBe('bedrock')
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', channel: 'answer', text: 'Bedrock routed correctly.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('combobox', { name: 'Chat model' }).selectOption('bedrock')
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Bedrock routed correctly.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Chat model' })).toHaveValue('bedrock')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
