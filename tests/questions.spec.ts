import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`project MCQs resume a real scoped mutation at ${width}px`, async ({ page, request }) => {
    const created = await request.post('/api/hardware/projects', { data: { name: 'Questionnaire integration', board: 'arduino-uno' } })
    const project = await created.json()
    const questions = { summary: 'Choose the behavior before we build.', questions: [
      { id: 'behavior', question: 'How should the LED work?', options: [{ id: 'blink', label: 'Blink' }, { id: 'steady', label: 'Steady' }] },
      { id: 'color', question: 'Which color?', options: [{ id: 'red', label: 'Red' }, { id: 'blue', label: 'Blue' }] },
      { id: 'speed', question: 'Which interval?', options: [{ id: '500', label: '500 ms' }, { id: '1000', label: '1 second' }] },
    ] }
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    let calls = 0
    await page.route('**/api/chat', async route => {
      calls++
      const body = route.request().postDataJSON()
      expect(body.project_id).toBe(project.id)
      if (calls === 1) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'questions', ...questions }) + '\n' + JSON.stringify({ type: 'done', status: 'awaiting_answers' }) + '\n' })
      expect(body.project_answers).toEqual({ behavior: 'blink', color: 'red', speed: '500' })
      const result = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'add_component', args: { type: 'led', id: 'agent_led', expected_revision: 1, properties: { color: 'red' } }, runtime_token: project.runtime_token } })
      expect(result.ok()).toBe(true)
      return route.fulfill({ contentType: 'application/x-ndjson', body: [
        { type: 'step_start', id: 'add', label: 'Add component', command: 'add_component(led)' },
        { type: 'step_end', id: 'add', status: 'success', output: 'Added agent_led' },
        { type: 'text', channel: 'answer', text: 'The LED is placed in your circuit.' },
        { type: 'done', status: 'success' },
      ].map(event => JSON.stringify(event)).join('\n') + '\n' })
    })
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Build a blinking LED circuit')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const form = page.getByRole('form', { name: 'Project requirements' })
    await expect(form).toBeVisible()
    await expect(form.getByRole('button', { name: 'Confirm and build circuit' })).toBeDisabled()
    for (const label of ['Blink', 'Red', '500 ms']) await form.getByRole('radio', { name: label, exact: true }).check()
    await form.getByRole('button', { name: 'Confirm and build circuit' }).click()
    await expect(page.getByText('The LED is placed in your circuit.', { exact: true })).toBeVisible()
    if (width < 900) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Select agent_led', exact: true })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `test-results/questions-${width}.png` })
    expect(calls).toBe(2)
  })
}
