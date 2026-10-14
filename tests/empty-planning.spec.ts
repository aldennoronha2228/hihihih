import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`empty project builds from inferred defaults without a questionnaire at ${width}px`, async ({ page, request }) => {
    test.setTimeout(120000)
    const created = await request.post('/api/hardware/projects', { data: { name: 'Empty planning verification' } })
    const project = await created.json()
    expect(project.components).toEqual([])
    expect(project.firmware.source).toBe('')
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    let calls = 0
    await page.route('**/api/chat', async route => {
      const body = route.request().postDataJSON()
      calls++
      expect(body.project_answers).toBeUndefined()
      const response = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name: 'add_component', args: { type: 'pi-pico', expected_revision: 1 }, runtime_token: project.runtime_token } })
      expect(response.ok()).toBe(true)
      return route.fulfill({ body: JSON.stringify({ type: 'step_start', id: 'board', label: 'Place inferred board', command: 'add_component(pi-pico)' }) + '\n' + JSON.stringify({ type: 'step_end', id: 'board', status: 'success', output: 'Selected Pico placed' }) + '\n' + JSON.stringify({ type: 'text', channel: 'answer', text: 'I placed the Pico board.' }) + '\n' + JSON.stringify({ type: 'done', status: 'success' }) + '\n' })
    })
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Build a temperature project')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('form', { name: 'Project requirements' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Set up your project' })).toHaveCount(0)
    await expect(page.getByText('I placed the Pico board.', { exact: true })).toBeVisible()
    if (width < 900) await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Select board', exact: true })).toBeVisible()
    const saved = await (await request.get(`/api/hardware/projects/${project.id}`)).json()
    expect(saved.board).toBe('pi-pico')
    expect(saved.components).toHaveLength(1)
    expect(saved.components[0].type).toBe('pi-pico')
  })
}
