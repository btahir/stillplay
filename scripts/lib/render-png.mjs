/**
 * Render HTML or SVG snippets to PNG files with Playwright's headless Chromium.
 * Heavy: run the calling script through scripts/heavy.sh. Returns false when Playwright
 * or its browser is not installed, so callers can fall back gracefully.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export async function renderPngs(jobs, { baseDir } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    return false;
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.warn(`PNG rendering skipped: ${error.message.split('\n')[0]}`);
    return false;
  }
  const scratch = join(baseDir || tmpdir(), `.render-${process.pid}`);
  await mkdir(scratch, { recursive: true });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const [index, job] of jobs.entries()) {
      const file = join(scratch, `${index}.html`);
      await writeFile(file, job.html);
      await page.setViewportSize({ width: job.width, height: job.height });
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => document.fonts.ready);
      await mkdir(dirname(job.out), { recursive: true });
      await page.screenshot({ path: job.out, omitBackground: Boolean(job.transparent), clip: { x: 0, y: 0, width: job.width, height: job.height } });
    }
    await context.close();
  } finally {
    await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
  return true;
}
