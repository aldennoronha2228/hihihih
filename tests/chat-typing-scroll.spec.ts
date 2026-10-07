import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`reply types progressively without stealing scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    await page.addInitScript(() => {
      const original = fetch.bind(window)
      window.fetch = (input, init) => input === '/api/chat' ? Promise.resolve(new Response(new ReadableStream({ start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', channel: 'answer', text: 'First section.\n\n' + 'A detailed answer line.\n\n'.repeat(80) }) + '\n'))
        Object.assign(window, { finishTypingTest: () => {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', channel: 'answer', text: '\n\nFinal section.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n'))
          controller.close()
        } })
      } }))) : original(input, init)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Tell me more')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const answer = page.getByRole('article', { name: 'WireUp message' })
    await expect(answer).toContainText('First section')
    const firstLength = (await answer.textContent())!.length
    expect(firstLength).toBeLessThan(1900)
    await expect.poll(async () => (await answer.textContent())!.length).toBeGreaterThan(firstLength)
    const scroll = page.getByRole('log', { name: 'Conversation' }).locator('..')
    await scroll.evaluate(element => { element.scrollTop = 0 })
    await page.evaluate(() => (window as unknown as { finishTypingTest: () => void }).finishTypingTest())
    await expect(answer).toContainText('Final section', { timeout: 10000 })
    expect(await scroll.evaluate(element => element.scrollTop)).toBeLessThan(10)
    await page.getByRole('button', { name: 'Scroll to latest message' }).click()
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  })
}
