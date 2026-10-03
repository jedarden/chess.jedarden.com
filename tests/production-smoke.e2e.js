import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const productionUrl = new URL(process.env.CHESS_PRODUCTION_URL ?? 'https://chess.jedarden.com/');
const engineAssets = [
  '/engine-worker.js',
  '/engine/sf_19_smallnet.js',
  '/engine/sf_19_smallnet.wasm',
  '/engine/nn-61e7af4bb97d.nnue',
];

function browserCandidates() {
  return [
    process.env.CHESS_BROWSER_PATH,
    process.env.BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
}

async function runnableBrowser() {
  for (const candidate of browserCandidates()) {
    if (candidate.includes('*') || !existsSync(candidate)) continue;
    try {
      const probe = await chromium.launch({ executablePath: candidate, headless: true });
      await probe.close();
      return candidate;
    } catch {
      // A browser binary can exist while its host is missing a shared library.
    }
  }
  return null;
}

const executable = await runnableBrowser();

test('production serves the app, engine, headers, analysis, and Agentation', { skip: executable ? false : 'No Chromium executable found; set CHESS_BROWSER_PATH to run the production smoke test.' }, async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'unknown error'})`));

  try {
    const homepage = await page.goto(productionUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(homepage?.status(), 200, 'production homepage should return HTTP 200');
    assert.equal(homepage?.headers()['cross-origin-opener-policy'], 'same-origin');
    assert.equal(homepage?.headers()['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(await page.evaluate(() => window.crossOriginIsolated), true, 'production page should be cross-origin isolated');
    assert.match(await page.title(), /Chess Workbench/);
    await page.locator('#notation').waitFor();

    for (const asset of engineAssets) {
      const response = await fetch(new URL(asset, productionUrl));
      assert.equal(response.status, 200, `${asset} should return HTTP 200`);
      assert.ok((await response.arrayBuffer()).byteLength > 0, `${asset} should not be empty`);
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin', `${asset} should expose COOP`);
      assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp', `${asset} should expose COEP`);
    }

    await page.waitForSelector('#agentation-root', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('[data-feedback-toolbar]', { state: 'attached', timeout: 15000 });
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('agentation-root'))), true);
    assert.ok(await page.locator('[data-feedback-toolbar]').count() > 0, 'Agentation toolbar should render');

    await page.locator('#notation').fill('1. e4');
    await page.locator('#depth').selectOption('8');
    await page.locator('#analyze').click();
    await page.waitForFunction(() => document.querySelector('#progress-label')?.textContent === 'Analysis complete', null, { timeout: 60000 });
    assert.equal(await page.locator('#progress-count').textContent(), '2 / 2');
    assert.notEqual(await page.locator('#score-value').textContent(), '—');
    assert.equal(await page.locator('#input-error').getAttribute('hidden'), '');

    assert.deepEqual(consoleErrors, [], `production page console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors, [], `production page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(failedRequests, [], `production resource failures: ${failedRequests.join(' | ')}`);
  } finally {
    await browser.close();
  }
});
