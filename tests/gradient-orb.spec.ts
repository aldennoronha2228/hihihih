import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`orb renders and animates at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('/orb')
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(async () => canvas.evaluate(element => element.width)).toBeGreaterThan(0)
    await expect(canvas).toHaveJSProperty('clientWidth', viewport.width)
    await expect(canvas).toHaveJSProperty('clientHeight', viewport.height)

    const pixels = async () => {
      const image = PNG.sync.read(await canvas.screenshot())
      return Array.from(image.data.filter((_, index) => index % 128 < 3))
    }
    await expect.poll(async () => Math.max(...await pixels()), { timeout: 15_000 }).toBeGreaterThan(80)
    const first = await pixels()
    await expect.poll(async () => JSON.stringify(await pixels()) !== JSON.stringify(first)).toBe(true)
    await page.screenshot({ path: `test-results/orb-${viewport.width}.png` })

    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(canvas).toHaveJSProperty('clientWidth', 768)
    await expect(canvas).toHaveJSProperty('clientHeight', 1024)
    await page.reload()
    await expect(page.locator('canvas')).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('custom configuration updates and component remounts cleanly', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/orb')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const rootPath = '/node_modules/.vite/deps/react-dom_client.js'
    const orbPath = '/src/components/ui/gradient-orb.tsx'
    const reactModule = await import(reactPath)
    const createElement = reactModule.createElement ?? reactModule.default.createElement
    const rootModule = await import(rootPath)
    const createRoot = rootModule.createRoot ?? rootModule.default.createRoot
    const { GradientOrb } = await import(orbPath)
    const host = document.createElement('div')
    host.id = 'configuration-test'
    host.style.cssText = 'width:320px;height:240px;position:fixed;inset:0;z-index:1'
    document.body.append(host)
    const root = createRoot(host)
    const render = (config: Record<string, unknown>) => root.render(createElement(GradientOrb, {
      config, className: 'custom-orb',
    }))
    Object.assign(window, { orbTest: { render, unmount: () => root.unmount() } })
    render({ background: '#123456', hue: 120, rotationSpeed: 0, noiseScale: 0.8, innerRadius: 0.2 })
  })
  const host = page.locator('#configuration-test')
  await expect(host.locator('canvas')).toBeVisible()
  await expect(host.locator('.custom-orb')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await expect(host.locator('canvas')).toHaveJSProperty('clientWidth', 320)
  await page.evaluate(() => {
    const state = (window as unknown as { orbTest: { render: (config: object) => void } }).orbTest
    state.render({ background: '#220044', hue: 240, rotationSpeed: -0.5, noiseScale: 1.2, innerRadius: 0 })
  })
  await expect(host.locator('.custom-orb')).toHaveCSS('background-color', 'rgb(34, 0, 68)')
  await page.evaluate(() => {
    (window as unknown as { orbTest: { unmount: () => void } }).orbTest.unmount()
  })
  await expect(host.locator('canvas')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})
