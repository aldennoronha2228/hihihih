import { expect, test } from '@playwright/test'

test('running step streams incrementally and stays visible on completion', async ({ page }) => {
  {
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        if (input !== '/api/chat') return original(input, init)
        const encoder = new TextEncoder()
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'step_start', id: 'live', label: 'Live step', command: 'model.astream(history)' }) + '\n'))
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', channel: 'answer', text: 'Partial answer' }) + '\n'))
          Object.assign(window, { finishActivityTest: () => {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'step_end', id: 'live', status: 'success', output: 'Completed output' }) + '\n' + JSON.stringify({ type: 'done', elapsedMs: 4200 }) + '\n'))
            controller.close()
          } })
        } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
      }
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox').fill('Hello')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Working on your project…')).toBeVisible()
    const running = page.getByRole('button', { name: 'Live step' })
    await expect(running).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Partial answer', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as unknown as { finishActivityTest: () => void }).finishActivityTest())
    await expect(page.getByText('Finished', { exact: true })).toBeVisible()
    const finished = page.getByRole('button', { name: 'Live step' })
    await expect(finished).toHaveAttribute('aria-expanded', 'false')
    await finished.click()
    await expect(page.getByText('Completed output', { exact: true })).toBeVisible()
  }
})

for (const width of [1440, 390]) {
  test(`ordered activity keeps every step visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test-model' } }))
    await page.route('**/api/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'text', channel: 'narration', text: 'Preparing the response.' },
      { type: 'step_start', id: 'a', label: 'Check context', command: 'validate(history)' },
      { type: 'step_end', id: 'a', status: 'success', output: 'Context accepted.' },
      { type: 'step_start', id: 'b', label: 'Generate answer', command: 'model.astream(history)' },
      { type: 'step_end', id: 'b', status: 'success', output: 'Model completed.' },
      { type: 'text', channel: 'answer', text: 'The final answer.' },
      { type: 'done', elapsedMs: 5100 },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' }))
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox').fill('Hello')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('The final answer.', { exact: true })).toBeVisible()
    await expect(page.getByText('Preparing the response.', { exact: true })).toBeVisible()
    await expect(page.getByText('Finished', { exact: true })).toBeVisible()
    const first = page.getByRole('button', { name: 'Check context' })
    const second = page.getByRole('button', { name: 'Generate answer' })
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(first).toHaveAttribute('aria-expanded', 'false')
    await first.click()
    await expect(page.getByText('validate(history)', { exact: true })).toBeVisible()
    await expect(page.getByText('Context accepted.', { exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/activity-${width}.png` })
    await page.reload()
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
