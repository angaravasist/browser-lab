// UI end-to-end: launch from the Quick test page, control the remote browser through the embedded noVNC canvas,
// capture evidence, record a result, end the session and export. Needs a running stack (docker compose up).
import { test, expect } from '@playwright/test';

const FIXTURE = process.env.BROWSERLAB_E2E_FIXTURE ?? 'http://app:3000/fixture/index.html';
const CATALOG = process.env.BROWSERLAB_E2E_CATALOG ?? 'firefox-149-linux';
const REMOTE = { width: 1920, height: 1080 }; // Selenium node desktop size

test('manual session from the UI', async ({ page, request }) => {
  await page.goto(`/#/?build=${CATALOG}`);
  await page.getByLabel('Web application URL').fill(FIXTURE);
  await expect(page.getByLabel('Version')).toHaveValue(CATALOG);
  await page.getByRole('button', { name: 'Launch real browser' }).click();

  await expect(page).toHaveURL(/#\/session\//, { timeout: 30_000 });
  const id = page.url().split('/session/')[1];
  await expect(page.getByText('Desktop: connected')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('Matched')).toBeVisible();

  const canvas = page.locator('.viewer canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + (x * box.width) / REMOTE.width, y: box.y + (y * box.height) / REMOTE.height });
  const currentUrl = async () => (await (await request.get(`/api/sessions/${id}?refresh=1`)).json()).currentUrl as string;

  // Real pointer + keyboard events into the canvas: focus the heading, Tab to the name field, type, Enter submits.
  const h = at(1100, 150);
  await page.mouse.click(h.x, h.y);
  await page.keyboard.press('Tab');
  await page.keyboard.type('e2e');
  await page.keyboard.press('Enter');
  await expect.poll(currentUrl, { timeout: 20_000 }).toContain('name=e2e');

  // Release the keyboard from the remote desktop before using BrowserLab's own controls.
  await page.getByRole('heading', { name: 'Result' }).click();
  await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
  await expect(page.getByText('Screenshot saved.')).toBeVisible();
  await page.getByLabel('Outcome').selectOption('passed');
  await page.getByLabel('Notes').fill('E2E: form typed through the viewer.');
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved.')).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.thumbs img')).toHaveCount(1);

  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.locator(`a[href="#/session/${id}"]`)).toBeVisible();
  for (const fmt of ['json', 'csv', 'html']) expect((await request.get(`/api/reports/export?format=${fmt}`)).ok()).toBeTruthy();
  const s = await (await request.get(`/api/sessions/${id}`)).json();
  expect(s.result.outcome).toBe('passed');
  expect(s.state).toBe('completed');
});
