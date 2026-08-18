import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const enabled = process.env.DSH_E2E_LIVE_MODEL === '1'
const sessionTitle = process.env.DSH_E2E_SESSION_TITLE

test('renders an opt-in live model response', async ({ page }) => {
  test.skip(!enabled, 'Set DSH_E2E_LIVE_MODEL=1 to consume model tokens')
  test.skip(sessionTitle === undefined, 'Set DSH_E2E_SESSION_TITLE to select a controlled session')

  await page.goto('/')
  const session = page.getByRole('treeitem').filter({ hasText: sessionTitle ?? '' })
  await expect(session).toBeVisible()
  await session.click()

  const marker = `DSH_E2E_${randomUUID()}`
  const input = page.getByRole('textbox', { name: 'Message the agent' })
  await input.fill(`Reply with exactly ${marker} and do not use tools.`)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText(marker).last()).toBeVisible({ timeout: 120_000 })
})
