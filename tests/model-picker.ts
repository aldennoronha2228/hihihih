import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ModelProvider } from '../src/lib/model-selection'

export const modelPicker = (page: Page) => page.getByRole('button', { name: /^Model: / })

export async function selectModel(page: Page, name: string | RegExp) {
  await modelPicker(page).click()
  const option = page.getByRole('option', { name, exact: true })
  await expect(option).toBeEnabled()
  await option.click()
  await expect(modelPicker(page)).toHaveAttribute('aria-expanded', 'false')
}

export async function expectSelectedModel(page: Page, label: string, provider: ModelProvider) {
  await expect(modelPicker(page)).toHaveAccessibleName(`Model: ${label}`)
  expect(await page.evaluate(() => localStorage.getItem('wireup.model-provider'))).toBe(provider)
  await modelPicker(page).click()
  await expect(page.getByRole('option', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
}

export async function seedModelPreference(page: Page, provider: ModelProvider) {
  await page.addInitScript(value => localStorage.setItem('wireup.model-provider', value), provider)
}
