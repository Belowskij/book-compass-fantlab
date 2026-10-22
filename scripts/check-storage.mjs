import { chromium, devices, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { book } from '../server/fantlab.ts';

const base = process.env.BASE_URL || 'http://localhost:5174';
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/hyperion.json', import.meta.url), 'utf8'));
const item = { book: book(fixture.children.find(row => Number(row.work_id ?? row.id) === 1)), status: 'reading', parents: [], updatedAt: '2026-10-22T00:00:00Z' };
const key = 'book-compass-library-v1';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] });
const errors = [];
async function open(raw, extra = {}) {
  const context = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
  await context.addInitScript(({ key, raw, extra }) => {
    if (!sessionStorage.getItem('storage-test-initialized')) {
      localStorage.setItem(key, raw);
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      sessionStorage.setItem('storage-test-initialized', '1');
    }
  }, { key, raw, extra });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?page=library');
  return { page, context };
}
try {
  const oldRaw = JSON.stringify({ 1: { ...item, book: { ...item.book, id: '1', authors: null } } });
  const old = await open(oldRaw);
  await expect(old.page.locator('.library-row')).toHaveCount(1);
  await expect(old.page.locator('#status-1')).toHaveValue('reading');
  expect(await old.page.evaluate(k => localStorage.getItem(k), key)).toBe(oldRaw);
  await old.page.locator('#status-1').selectOption('want');
  await expect(old.page.getByRole('alert')).toHaveCount(0);
  expect(await old.page.evaluate(k => localStorage.getItem(k + '-recovery'), key)).toBe(oldRaw);
  await old.page.reload();
  await expect(old.page.locator('#status-1')).toHaveValue('want');
  console.log('Older local format restored, original archived, status survives reload');
  await old.context.close();

  const partialRaw = JSON.stringify({ version: 1, items: [item, null] });
  const partial = await open(partialRaw);
  await expect(partial.page.locator('.library-row')).toHaveCount(1);
  await expect(partial.page.getByRole('alert')).toContainText('Не удалось прочитать записей: 1');
  const downloaded = partial.page.waitForEvent('download');
  await partial.page.getByRole('button', { name: 'Скачать исходные данные для восстановления' }).click();
  const download = await downloaded;
  expect(await readFile(await download.path(), 'utf8')).toBe(partialRaw);
  expect(await partial.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  console.log('One invalid record preserves readable books and exact downloadable source; iPhone width OK');
  await partial.context.close();

  const broken = await open('{broken');
  await expect(broken.page.getByRole('alert')).toContainText('не удалось распознать');
  await broken.page.goto(base + '/?book=1');
  await expect(broken.page.locator('#work-status')).toBeVisible({ timeout: 60000 });
  await broken.page.locator('#work-status').selectOption('read');
  await expect(broken.page.getByRole('alert')).toContainText('Изменение не сохранено');
  expect(await broken.page.evaluate(k => localStorage.getItem(k), key)).toBe('{broken');
  await expect(broken.page.locator('.toast')).toHaveCount(0);
  console.log('Unreadable source cannot be overwritten by status changes or false success toast');
  await broken.context.close();

  const backup = await open('{broken', { [key + '-backup']: JSON.stringify({ version: 1, items: [item] }) });
  await expect(backup.page.locator('.library-row')).toHaveCount(1);
  await expect(backup.page.getByRole('alert')).toContainText('автоматической копии');
  await backup.context.close();

  const context = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    const original = Storage.prototype.getItem;
    window.restoreStorageForTest = () => { Storage.prototype.getItem = original; };
    Storage.prototype.getItem = function(key) {
      if (key.startsWith('book-compass-library')) throw new DOMException('Access denied', 'SecurityError');
      return original.call(this, key);
    };
  });
  const blocked = await context.newPage();
  await blocked.goto(base + '/?page=library');
  await expect(blocked.getByRole('alert')).toContainText('запретил доступ к памяти сайта');
  await blocked.evaluate(() => window.restoreStorageForTest());
  await blocked.getByRole('button', { name: 'Попробовать ещё раз', exact: true }).click();
  await expect(blocked.getByRole('alert')).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
  console.log('Automatic copy recovery and retry after browser access denial OK; no JavaScript errors');
} finally { await browser.close(); }
