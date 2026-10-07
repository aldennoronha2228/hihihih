import { expect, test } from '@playwright/test'

test('empty paused assistant messages are excluded from chat requests', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.addInitScript(() => localStorage.setItem('wireup.chats.v1', JSON.stringify([{ id: 'paused', title: 'Paused review', updatedAt: Date.now(), messages: [{ id: 'u', role: 'user', content: 'Build LED' }, { id: 'a', role: 'assistant', content: '', status: 'done' }] }])))
  await page.route('**/api/chat', route => {
    expect(route.request().postDataJSON().messages.every((message: { content: string }) => message.content.trim())).toBe(true)
    return route.fulfill({ body: JSON.stringify({ type: 'text', channel: 'answer', text: 'Request accepted.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
  })
  await page.goto('/chat/paused', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Continue')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Request accepted.', { exact: true })).toBeVisible()
})

test('422 errors show the actual validation field and reason', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.route('**/api/chat', route => route.fulfill({ status: 422, json: { detail: [{ loc: ['body', 'approval', 'assessment_id'], msg: 'String should have at least 32 characters' }] } }))
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Continue')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('approval.assessment_id: String should have at least 32 characters')
})
