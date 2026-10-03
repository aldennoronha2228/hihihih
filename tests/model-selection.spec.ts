import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`NVIDIA and Groq selection drives requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const providers: string[] = []
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-model', providers: [
      { id: 'groq', label: 'Groq', model: 'groq-model', configured: true },
      { id: 'nvidia', label: 'NVIDIA', model: 'z-ai/glm-5.3', configured: true },
    ] } }))
    await page.route('**/api/chat', route => {
      providers.push(route.request().postDataJSON().provider)
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', channel: 'answer', text: 'Model selection verified.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    const selector = page.getByRole('combobox', { name: 'Chat model' })
    await expect(selector).toContainText('z-ai/glm-5.3')
    await selector.selectOption('nvidia')
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello NVIDIA')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Model selection verified.', { exact: true })).toBeVisible()
    expect(providers).toEqual(['nvidia'])
    await page.reload()
    await expect(selector).toHaveValue('nvidia')
    await selector.selectOption('groq')
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello Groq')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('article', { name: 'WireUp message' })).toHaveCount(2)
    expect(providers).toEqual(['nvidia', 'groq'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/model-selector-${width}.png` })
  })
}

test('missing NVIDIA key shows provider-specific setup guidance', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-model', providers: [
    { id: 'groq', label: 'Groq', model: 'groq-model', configured: true },
    { id: 'nvidia', label: 'NVIDIA', model: 'z-ai/glm-5.3', configured: false },
  ] } }))
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox', { name: 'Chat model' }).selectOption('nvidia')
  await expect(page.getByRole('status')).toContainText('NVIDIA_API_KEY')
})
