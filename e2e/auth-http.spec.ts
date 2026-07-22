import { expect, test } from '@playwright/test'

test('signs in over direct self-hosted HTTP', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByRole('button', { name: 'Create super admin' }).click()
  await expect(page.getByRole('heading', { name: 'Choose storage' })).toBeVisible()

  await page.context().clearCookies()
  await page.reload()
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Choose storage' })).toBeVisible()
  if (process.env.CAPTURE_E2E_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/auth-http-success.png', fullPage: true })
})
