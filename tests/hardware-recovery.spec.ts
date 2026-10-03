import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { HardwareProject } from '../src/lib/hardware'

const project: HardwareProject = {
  id: 'recovery', schema_version: 1, revision: 1, name: 'Recovery prototype', board: 'unselected',
  components: [], wires: [], firmware: { filename: 'sketch.ino', source: '', revision: 1 },
  history: [], compiler: null, runtime_token: 'test-runtime-token', created_at: '', updated_at: '',
}

async function mockServices(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: false } }))
  await page.route('**/api/hardware/catalog**', route => route.fulfill({ json: { components: [], boards: [] } }))
  await page.route('**/api/hardware/projects', route => route.fulfill({ json: { projects: [] } }))
  await page.routeWebSocket('**/api/hardware/project/*/runtime*', socket => {
    socket.send(JSON.stringify({ type: 'runtime_connected', project_id: project.id }))
  })
}

test('hung project read becomes a clear error and can be retried', async ({ page }) => {
  await mockServices(page)
  let attempts = 0
  await page.route('**/api/hardware/projects/recovery', route => {
    attempts++
    if (attempts > 1) return route.fulfill({ json: project })
  })
  await page.goto('/project/recovery', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Unable to open this project' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('alert')).toContainText('Project read timed out after 15 seconds')
  await expect(page.getByRole('alert')).not.toContainText(project.runtime_token)
  await page.getByRole('button', { name: 'Retry loading' }).click()
  await expect(page.getByText(project.name, { exact: true }).first()).toBeVisible()
})

test('polling, focus and agent updates share one read and cancel on navigation', async ({ page }) => {
  await mockServices(page)
  let reads = 0
  await page.route('**/api/hardware/projects/recovery', route => {
    reads++
    if (reads === 1) return route.fulfill({ json: project })
  })
  await page.goto('/project/recovery', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(project.name, { exact: true }).first()).toBeVisible()
  await expect.poll(() => reads).toBe(2)
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: request => new URL(request.url()).pathname === '/api/hardware/projects/recovery',
  })
  await page.evaluate(() => {
    for (let index = 0; index < 10; index++) {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new CustomEvent('wireup-project-updated', { detail: 'recovery' }))
    }
  })
  await page.waitForTimeout(4500)
  expect(reads).toBe(2)
  await page.getByRole('link', { name: 'WireUp home' }).click()
  await cancelled
  await expect(page).toHaveURL('/')
  await page.waitForTimeout(2500)
  expect(reads).toBe(2)
})

test('API deadlines cover response bodies, preserve invalid JSON errors and respect caller cancellation', async ({ page }) => {
  await page.goto('/favicon.svg', { waitUntil: 'load' })
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/hardware.ts'
    const { hardwareApi, HardwareApiError, hardwareCommandTimeoutMs, createRequestSignal } = await import(modulePath) as typeof import('../src/lib/hardware')
    const originalFetch = window.fetch
    const messages: { message: string; status: number; apiError: boolean }[] = []
    try {
      window.fetch = async () => new Response('not-json', { status: 502 })
      try { await hardwareApi.getProject('invalid') } catch (error) {
        const failure = error as InstanceType<typeof HardwareApiError>
        messages.push({ message: failure.message, status: failure.status, apiError: failure instanceof HardwareApiError })
      }
      window.fetch = async () => new Response('not-json', { status: 200 })
      try { await hardwareApi.getProject('invalid') } catch (error) {
        const failure = error as InstanceType<typeof HardwareApiError>
        messages.push({ message: failure.message, status: failure.status, apiError: failure instanceof HardwareApiError })
      }
      window.fetch = async (_input, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
        },
      }))
      const caller = new AbortController()
      const pending = hardwareApi.getProject('cancelled', { signal: caller.signal }).catch(error => error.name as string)
      caller.abort()
      const cancellation = await pending
      const deadline = createRequestSignal(20)
      await new Promise<void>(resolve => deadline.signal.addEventListener('abort', () => resolve(), { once: true }))
      const timedOut = deadline.timedOut
      deadline.dispose()
      const bodyPending = hardwareApi.getProject('hung-body').catch(error => ({ message: error.message as string, status: error.status as number }))
      const bodyError = await bodyPending
      return {
        messages, cancellation, timedOut, bodyError,
        timeouts: [hardwareCommandTimeoutMs('arduino-uno', 'compile_firmware'), hardwareCommandTimeoutMs('pi-pico', 'compile_firmware'), hardwareCommandTimeoutMs('esp32-c3', 'compile_firmware'), hardwareCommandTimeoutMs('custom', 'compile_firmware', 1000), hardwareCommandTimeoutMs('esp32-c3', 'run_simulation'), hardwareCommandTimeoutMs('esp32-c3', 'read_simulation_results')],
      }
    } finally { window.fetch = originalFetch }
  })
  expect(result.messages).toEqual([
    { message: 'Hardware request failed (502).', status: 502, apiError: true },
    { message: 'Hardware server returned an invalid response.', status: 200, apiError: true },
  ])
  expect(result.cancellation).toBe('AbortError')
  expect(result.timedOut).toBe(true)
  expect(result.bodyError).toMatchObject({ status: 408, message: expect.stringContaining('Project read timed out after 15 seconds') })
  expect(result.timeouts).toEqual([120_000, 330_000, 630_000, 660_000, 15_000, 15_000])
})

test('failed lazy workspace displays truthful fallback and reload fetches a fresh module', async ({ page }) => {
  await mockServices(page)
  await page.route('**/api/hardware/projects/recovery', route => route.fulfill({ json: project }))
  const applicationErrors: string[] = []
  page.on('pageerror', error => applicationErrors.push(error.message))
  await page.route('**/src/components/hardware-workspace.tsx*', route => route.abort('failed'))
  await page.goto('/project/recovery', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Unable to load this workspace' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Reload to fetch the application again')
  await expect(page.getByText('Saved server projects are not deleted by these actions. Unsaved changes on this page may be lost.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  expect(applicationErrors.every(message => /dynamically imported module|Importing a module script|Failed to fetch/i.test(message))).toBe(true)
  await page.unroute('**/src/components/hardware-workspace.tsx*')
  await page.getByRole('button', { name: 'Reload page' }).click()
  await expect(page.getByText(project.name, { exact: true }).first()).toBeVisible()
})

test('component registry retries a failed shared metadata load', async ({ page }) => {
  await page.goto('/favicon.svg', { waitUntil: 'load' })
  const result = await page.evaluate(async () => {
    const modulePath = '/vendor/velxio/frontend/src/services/ComponentRegistry.ts'
    const { ComponentRegistry } = await import(modulePath) as typeof import('../vendor/velxio/frontend/src/services/ComponentRegistry')
    const registry = ComponentRegistry.getInstance()
    await registry.load()
    const originalFetch = window.fetch
    let attempts = 0
    window.fetch = async () => {
      attempts++
      return attempts === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify({ components: [] }), { status: 200 })
    }
    try {
      const first = await Promise.allSettled([registry.reload(), registry.loadPromise])
      const failedAttempts = attempts
      await registry.load()
      const retryAttempts = attempts
      await registry.reload()
      return { statuses: first.map(value => value.status), failedAttempts, retryAttempts, attempts, loaded: registry.isLoaded }
    } finally { window.fetch = originalFetch }
  })
  expect(result).toEqual({ statuses: ['rejected', 'rejected'], failedAttempts: 1, retryAttempts: 2, attempts: 3, loaded: true })
})
