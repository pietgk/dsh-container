import { expect, type Page, test } from '@playwright/test'

const sessionTitle = process.env.DSH_E2E_SESSION_TITLE

function fatalConsoleErrors(page: Page): string[] {
  const messages: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(message.text())
  })
  page.on('pageerror', (error) => messages.push(error.message))
  return messages
}

async function maskDynamicUi(page: Page) {
  return [page.getByRole('tree', { name: 'Sessions' }), page.locator('text=/^\\d{2}:\\d{2}$/')]
}

test('renders the DSH shell and configured provider without exposing a key', async ({ page }) => {
  const errors = fatalConsoleErrors(page)
  await page.goto('/')

  await expect(page).toHaveTitle(/DeepSeek Harness/)
  await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
  await expect(page.getByRole('tree', { name: 'Sessions' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: 'Models' }).click()
  await expect(settings.getByRole('heading', { name: 'Models' })).toBeVisible()
  await expect(settings.getByRole('img', { name: 'API key configured' })).toBeVisible()
  await expect(settings).not.toContainText(/sk-[a-z0-9]/i)

  await expect(page).toHaveScreenshot('configured-provider.png', {
    animations: 'disabled',
    mask: await maskDynamicUi(page),
    maskColor: '#202124',
  })
  expect(errors).toEqual([])
})

test('renders a controlled persisted transcript after reload', async ({ page }) => {
  test.skip(
    sessionTitle === undefined,
    'Set DSH_E2E_SESSION_TITLE to inspect a controlled transcript',
  )
  const errors = fatalConsoleErrors(page)
  await page.goto('/')

  const session = page.getByRole('treeitem').filter({ hasText: sessionTitle ?? '' })
  await expect(session).toBeVisible()
  await session.click()
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
  await expect(page.getByText(/turns.*steps/i)).toBeVisible()
  await expect(page.getByText(/test result/i).first()).toBeVisible()

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible()
  await expect(page.getByText(/test result/i).first()).toBeVisible()

  await expect(page).toHaveScreenshot('controlled-transcript.png', {
    animations: 'disabled',
    fullPage: true,
    mask: await maskDynamicUi(page),
    maskColor: '#202124',
  })
  expect(errors).toEqual([])
})
