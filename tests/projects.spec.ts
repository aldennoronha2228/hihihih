import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`five recent projects, selection and deletion at ${width}px`, async ({ page }) => {
    let projects = Array.from({ length: 8 }, (_, index) => ({ id: `project-${index}`, name: `Prototype ${index}`, board: 'arduino-uno', revision: 1, created_at: '2026-10-01T00:00:00Z', updated_at: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z` }))
    const deleted: string[] = []
    await page.route('**/api/hardware/projects*', route => route.fulfill({ json: { projects } }))
    await page.route('**/api/hardware/projects/*', route => {
      const id = new URL(route.request().url()).pathname.split('/').pop()!
      if (route.request().method() === 'DELETE') {
        projects = projects.filter(project => project.id !== id)
        deleted.push(id)
        return route.fulfill({ json: { deleted: id } })
      }
      return route.fulfill({ status: 404, json: { detail: 'Project not found.' } })
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const list = page.getByRole('region', { name: 'Project list' })
    await expect(list.locator('h3')).toHaveCount(5)
    await expect(list.locator('h3').first()).toHaveText('Prototype 7')
    await expect(list.getByText('Prototype 0', { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'All projects (8)' }).click()
    await expect(page).toHaveURL('/projects')
    await expect(list.locator('h3')).toHaveCount(8)
    await page.getByRole('button', { name: 'Select projects', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Select Prototype 0', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Select Prototype 1', exact: true }).check()
    await page.getByRole('button', { name: 'Delete selected (2)' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(deleted).toEqual([])
    await page.getByRole('button', { name: 'Delete selected (2)' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete projects', exact: true }).click()
    await expect(list.locator('h3')).toHaveCount(6)
    expect(deleted).toEqual(['project-0', 'project-1'])
    await page.getByRole('link', { name: 'Back to home' }).click()
    await expect(list.locator('h3')).toHaveCount(5)
    await page.getByRole('button', { name: 'Select projects', exact: true }).click()
    await page.getByRole('button', { name: 'Select all shown', exact: true }).click()
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(5)
    await page.getByRole('button', { name: 'Cancel selection' }).click()
    await page.screenshot({ path: `test-results/projects-${width}.png` })
    await page.goto('/projects', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Select projects', exact: true }).click()
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: 'Delete selected (6)' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete projects', exact: true }).click()
    await expect(list).toContainText('No saved projects')
  })
}

test('failed deletion remains selected and displays the server error', async ({ page }) => {
  await page.route('**/api/hardware/projects', route => route.fulfill({ json: { projects: [{ id: 'open', name: 'Open project', board: 'arduino-uno', revision: 1, updated_at: '2026-10-03' }] } }))
  await page.route('**/api/hardware/projects/open', route => route.fulfill({ status: 409, json: { detail: 'Close its workspace before deleting it.' } }))
  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Select projects' }).click()
  await page.getByRole('checkbox', { name: 'Select Open project' }).check()
  await page.getByRole('button', { name: 'Delete selected (1)' }).click()
  await page.getByRole('button', { name: 'Delete projects', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Close its workspace')
  await expect(page.getByRole('checkbox', { name: 'Select Open project' })).toBeChecked()
})
