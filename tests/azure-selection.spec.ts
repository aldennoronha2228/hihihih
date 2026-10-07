import { expect, test } from '@playwright/test'
import { expectSelectedModel, modelPicker, seedModelPreference, selectModel } from './model-picker'

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
    await selectModel(page, 'gpt-6.1-sol')
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Hello Azure')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('Azure route verified.', { exact: true })).toBeVisible()
    await page.reload()
    await expectSelectedModel(page, 'gpt-6.1-sol', 'azure')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Azure missing key shows correct setup field', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'groq-test', providers: [
    { id: 'groq', label: 'Groq', model: 'groq-test', configured: true },
    { id: 'azure', label: 'Azure', model: 'gpt-6.1-sol', configured: false },
  ] } }))
  await seedModelPreference(page, 'azure')
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('status')).toContainText('AZURE_API_KEY')
  await modelPicker(page).click()
  await expect(page.getByRole('option', { name: 'gpt-6.1-sol', exact: true })).toBeDisabled()
})
