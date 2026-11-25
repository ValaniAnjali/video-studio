import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const SAMPLE = path.resolve(import.meta.dirname, 'fixtures/sample.webm') // 3 seconds

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
})

async function openEditorWithVideo(page: Page) {
  await page.goto('/')
  await page.getByText('New project →').click()
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/editor\//)
  const library = page.locator('aside[aria-label^="Media library"]')
  await library.locator('input[type=file]').first().setInputFiles(SAMPLE)
  await expect(library.locator('li[draggable]')).toHaveCount(1)
  await library.locator('li[draggable]').dblclick()
  await expect(page.locator('[data-clip-id]')).toHaveCount(1)
}

const segments = (page: Page) => page.getByTestId('segment')

test('tools switch to Cut & Split once a video is on the timeline', async ({ page }) => {
  await openEditorWithVideo(page)
  await expect(page.getByRole('tab', { name: 'Cut & Split' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Skip around')).toBeVisible()
  await expect(segments(page)).toHaveCount(1)
})

test('split into 3, cut the middle part, the outer parts join', async ({ page }) => {
  await openEditorWithVideo(page)
  await page.getByLabel('Number of parts').fill('3')
  await page.getByRole('button', { name: 'Split into equal parts' }).click()
  await expect(segments(page)).toHaveCount(3)

  await page.getByRole('button', { name: 'Cut part 2' }).click()
  await expect(segments(page)).toHaveCount(2)
  // 3 s video: one third removed -> about 2 s left, and the two parts touch (no gap button offered)
  await expect(page.getByRole('button', { name: /Remove gaps/ })).toHaveCount(0)
  await expect(page.getByText(/00:00 → 00:01/).first()).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(segments(page)).toHaveCount(3)
})

test('mark In/Out and cut a section with the keyboard', async ({ page }) => {
  await openEditorWithVideo(page)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight') // 1 s
  await page.keyboard.press('i')
  await page.keyboard.press('Shift+ArrowRight') // 2 s
  await page.keyboard.press('o')
  await expect(page.getByTestId('mark-range')).toBeVisible()
  await expect(page.getByTestId('mark-status')).toContainText('1.0 s')
  await page.keyboard.press('x')
  await expect(segments(page)).toHaveCount(2)
  await expect(page.getByTestId('mark-range')).toHaveCount(0)
})

test('skip buttons move the playhead and cut-point jumps work', async ({ page }) => {
  await openEditorWithVideo(page)
  const left = () => page.getByTestId('playhead').evaluate((e) => parseFloat((e as HTMLElement).style.left))
  const start = await left()
  await page.getByRole('button', { name: 'Forward 5 seconds' }).click() // clamps to the 3 s end
  expect(await left()).toBeGreaterThan(start)
  await page.getByTitle('Back 10 s').click()
  expect(await left()).toBe(start)
  await page.keyboard.press('l')
  expect(await left()).toBeGreaterThan(start)
})

test('merge: join another video at the end, then export one file', async ({ page }) => {
  await openEditorWithVideo(page)
  await page.getByRole('tab', { name: 'Merge' }).click()
  await page.locator('aside[aria-label^="Media library"] input[type=file][accept="video/*"]').setInputFiles(SAMPLE)
  await expect(page.locator('[data-clip-id]')).toHaveCount(2)

  await page.getByRole('tab', { name: 'Cut & Split' }).click()
  await expect(segments(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByText('Smart Export: full render')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: /Export & (download|save)/ }).click()])
  expect(download.suggestedFilename()).toMatch(/\.mp4$/)
  await expect(page.getByText('Export complete')).toBeVisible()
})
