import { expect, test } from '@playwright/test'
import path from 'node:path'

const SAMPLE = path.resolve(import.meta.dirname, 'fixtures/sample.webm')

// Headless browsers show a native save dialog for showSaveFilePicker; remove it so the
// app falls back to a normal browser download, which Playwright can capture.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
})

test('home page offers both editors', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Edit video without uploading/ })).toBeVisible()
  await expect(page.getByText('Quick Editor').first()).toBeVisible()
  await expect(page.getByText('Advanced Editor').first()).toBeVisible()
})

test('deep links work (SPA fallback)', async ({ page }) => {
  await page.goto('/quick/trim')
  await expect(page.getByText('Video Trimmer')).toBeVisible()
})

test('quick editor: trim a video and download it', async ({ page }) => {
  await page.goto('/quick/trim')
  await page.setInputFiles('input[type=file]', SAMPLE)
  await expect(page.locator('video')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Process/ }).click()])
  expect(download.suggestedFilename()).toMatch(/trimmed\.webm$/)
  await expect(page.getByText('Done')).toBeVisible()
})

test('quick editor: remove audio', async ({ page }) => {
  await page.goto('/quick/mute')
  await page.setInputFiles('input[type=file]', SAMPLE)
  await expect(page.locator('video')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Process/ }).click()])
  expect(download.suggestedFilename()).toMatch(/muted\./)
})

test('advanced editor: import, split, undo, autosave and export', async ({ page }) => {
  await page.goto('/')
  await page.getByText('New project →').click()
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/editor\//)

  const library = page.locator('aside[aria-label^="Media library"]')
  await library.locator('input[type=file]').first().setInputFiles(SAMPLE)
  await expect(library.locator('li[draggable]')).toHaveCount(1)
  await library.locator('li[draggable]').dblclick()
  await expect(page.locator('[data-clip-id]')).toHaveCount(1)

  // split at 1 second, then undo
  await page.keyboard.press('Home')
  for (let i = 0; i < 1; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('s')
  await expect(page.locator('[data-clip-id]')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-clip-id]')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('[data-clip-id]')).toHaveCount(2)

  // autosave (debounced ~700ms) survives a reload
  await page.waitForTimeout(1500)
  await expect(page.getByText('Saved')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-clip-id]')).toHaveCount(2)

  // export
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByText(/Smart Export/).first()).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: /Export & (download|save)/ }).click()])
  expect(download.suggestedFilename()).toMatch(/\.mp4$/)
  await expect(page.getByText('Export complete')).toBeVisible()
})
