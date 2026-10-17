import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

// Safe-rendering tests: hostile PGN text (tag values, comments, malformed
// input) must render as inert text — no element injection, no event handler,
// no execution. The Vite dev server sends no Content-Security-Policy, so these
// assertions prove the application's own escaping is the barrier; a deployed
// CSP (public/_headers) is defense-in-depth on top of it, never the only
// defense these tests would exercise.

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

const WHITE_PAYLOAD = '<img src=x onerror=window.__pgnInjected=true>';
const BLACK_PAYLOAD = '<script>window.__pgnInjected=true</script>';
const BREAKOUT_PAYLOAD = '" onmouseover="window.__pgnInjected=true><img src=x onerror=window.__pgnInjected=true>';
const RESULT_PAYLOAD = '<svg onload=window.__pgnInjected=true></svg>';
const BLACK_IFRAME_PAYLOAD = '<iframe src=javascript:window.__pgnInjected=true></iframe>';
const WHITE_TOGGLE_PAYLOAD = '<details open ontoggle=window.__pgnInjected=true>';
const COMMENT_MARKER = 'pgn-comment-canary-9f3d';

// Returns launch options for a working browser, or null when none exists.
// Explicit candidates are probed first so CHESS_BROWSER_PATH keeps precedence;
// an existing full-chrome binary can still crash at launch (missing host
// libraries), so as a last resort the playwright-managed browser resolved
// from PLAYWRIGHT_BROWSERS_PATH is probed too.
async function browserLaunchOptions() {
  const candidates = [
    process.env.CHESS_BROWSER_PATH,
    process.env.BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes('*') || !existsSync(candidate)) continue;
    try {
      const probe = await chromium.launch({ executablePath: candidate, headless: true });
      await probe.close();
      return { executablePath: candidate };
    } catch {
      // A browser binary can exist while its host is missing a shared library.
    }
  }
  try {
    const probe = await chromium.launch({ headless: true });
    await probe.close();
    return {};
  } catch {
    return null;
  }
}

const launchOptions = await browserLaunchOptions();

describe('safe rendering of user-supplied PGN content', { skip: launchOptions ? false : 'No Chromium executable found; set CHESS_BROWSER_PATH to run browser tests.' }, () => {
  let browser;
  let server;
  let baseUrl;

  before(async () => {
    await execFileAsync(process.execPath, ['scripts/prepare-engine.mjs'], { cwd: root });
    server = await createServer({
      configFile: resolve(root, 'vite.config.js'),
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**'] } },
    });
    await server.listen();
    const address = server.httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ ...launchOptions, headless: true });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  async function openPage() {
    const page = await browser.newPage();
    // The canary flips to true only if a payload's JavaScript ever runs.
    await page.addInitScript(() => { window.__pgnInjected = false; });
    await page.goto(`${baseUrl}/`);
    await page.locator('#notation').waitFor();
    return page;
  }

  async function analyze(page, source, moveCount) {
    await page.locator('#notation').fill(source);
    await page.locator('#depth').selectOption('8');
    await page.locator('#analyze').click();
    await page.waitForFunction(count => document.querySelector('#move-index')?.textContent === `0 / ${count}`, moveCount);
    if (await page.locator('#cancel').isVisible()) await page.locator('#cancel').click();
  }

  // Elements a markup payload could materialize. None of them are part of the
  // app's own DOM inside .page-shell (the score chart's <svg> is created by
  // renderGraph, so svg itself is excluded from the inventory).
  async function injectedInventory(page) {
    return page.locator('.page-shell').evaluate(shell => ({
      elements: [...shell.querySelectorAll('script, img, image, iframe, frame, object, embed, math, audio, video, source')]
        .map(element => element.tagName.toLowerCase()),
      handlerAttributes: [...shell.querySelectorAll('*')]
        .flatMap(element => [...element.attributes].filter(attribute => /^(on|srcdoc|javascript:)/i.test(attribute.name)).map(attribute => `${element.tagName.toLowerCase()}@${attribute.name}`)),
    }));
  }

  async function assertInert(page, label) {
    const inventory = await injectedInventory(page);
    assert.deepEqual(inventory.elements, [], `${label}: payload must not create elements`);
    assert.deepEqual(inventory.handlerAttributes, [], `${label}: payload must not attach event handlers`);
    assert.equal(await page.evaluate(() => window.__pgnInjected), false, `${label}: payload must not execute`);
  }

  async function assertTextPlate(page, selector, expected, label) {
    const plate = page.locator(selector);
    assert.equal(await plate.textContent(), expected, `${label}: ${selector} must show the payload as literal text`);
    assert.equal(await plate.evaluate(element => element.childElementCount), 0, `${label}: ${selector} must contain no child elements`);
  }

  test('renders hostile player-name tags as inert text in the name plates, insight, and summary', async () => {
    const page = await openPage();
    try {
      await analyze(page, `[Event "Safe rendering probe"]
[White "${WHITE_PAYLOAD}"]
[Black "${BLACK_PAYLOAD}"]

1. e4 e5 2. Nf3 Nc6 *`, 4);

      await assertTextPlate(page, '#white-name', WHITE_PAYLOAD, 'name plate');
      await assertTextPlate(page, '#black-name', BLACK_PAYLOAD, 'name plate');

      // The insight text interpolates the name for the selected move.
      await page.locator('#next').click();
      const insight = await page.locator('#insight-text').textContent();
      assert.ok(insight.startsWith(WHITE_PAYLOAD), `insight text must lead with the literal payload, got: ${JSON.stringify(insight.slice(0, 60))}`);
      assert.equal(await page.locator('#insight-text').evaluate(element => element.childElementCount), 0);

      // The summary card is the one surface that embeds names via escaped HTML.
      const summaryNames = await page.locator('#summary .summary-player strong').evaluateAll(strongs => strongs.map(strong => strong.textContent));
      assert.deepEqual(summaryNames, [WHITE_PAYLOAD, BLACK_PAYLOAD]);
      for (const strong of await page.locator('#summary .summary-player strong').all()) {
        assert.equal(await strong.evaluate(element => element.childElementCount), 0, 'summary name must contain no child elements');
      }

      await assertInert(page, 'hostile tags');
    } finally {
      await page.close();
    }
  });

  test('drops hostile comments without rendering or executing them', async () => {
    const page = await openPage();
    try {
      const source = `1. e4 {${WHITE_PAYLOAD}} e5
; ${BLACK_PAYLOAD}
2. Nf3 {${COMMENT_MARKER}} Nc6 *`;
      await analyze(page, source, 4);

      // Comments are accepted and ignored: the replay works and neither the
      // payload markup nor its marker text reaches any rendered surface.
      const shellText = await page.locator('.page-shell').textContent();
      assert.equal(shellText.includes(COMMENT_MARKER), false, 'comment text must not reach the rendered page');
      assert.equal(shellText.includes('<img'), false, 'comment markup must not reach the rendered page');

      const moves = await page.locator('#move-list .move-button span').evaluateAll(spans => spans.map(span => span.textContent));
      assert.deepEqual(moves, ['e4', 'e5', 'Nf3', 'Nc6']);

      await assertInert(page, 'hostile comments');
    } finally {
      await page.close();
    }
  });

  test('renders parser explanations for markup-carrying malformed input as inert text', async () => {
    const page = await openPage();
    try {
      const malformedInputs = [
        `1. e4 e5 2. ${WHITE_PAYLOAD}`,
        `[Black "${BLACK_PAYLOAD}]\n\n1. e4 *`,
        // An embedded quote breaks the tag-pair grammar, so this hostile
        // attribute breakout can only ever reach the error region.
        `[White "${BREAKOUT_PAYLOAD}"]\n\n1. e4 *`,
      ];
      for (const source of malformedInputs) {
        await page.locator('#notation').fill(source);
        await page.locator('#analyze').click();
        await page.locator('#input-error').waitFor({ state: 'visible' });
        const errorText = await page.locator('#input-error').textContent();
        assert.match(errorText, /could not be read/, 'parser explanation must be shown');
        assert.equal(await page.locator('#input-error').evaluate(element => element.childElementCount), 0, 'error region must contain no child elements');
        assert.equal(await page.locator('#move-index').textContent(), '0 / 0', 'a failed parse must not replay the input');
        assert.equal(await page.locator('#board .piece').count(), 32, 'a failed parse must leave the board untouched');
        await assertInert(page, 'malformed input');
      }
    } finally {
      await page.close();
    }
  });

  test('keeps event-handler and URL-scheme payloads inert across tag, result, and summary surfaces', async () => {
    const page = await openPage();
    try {
      const source = `[White "${WHITE_TOGGLE_PAYLOAD}"]
[Black "${BLACK_IFRAME_PAYLOAD}"]
[Result "${RESULT_PAYLOAD}"]

1. e4 e5 2. Nf3 Nc6 *`;
      await analyze(page, source, 4);

      await assertTextPlate(page, '#white-name', WHITE_TOGGLE_PAYLOAD, 'breakout name plate');
      await assertTextPlate(page, '#black-name', BLACK_IFRAME_PAYLOAD, 'breakout name plate');

      // Unlike the name tags, chess.js validates the Result header: a hostile
      // value is replaced with '*' before it could ever reach the page, so the
      // final game detail shows the plain in-progress wording instead.
      await page.locator('#last').click();
      await assertTextPlate(page, '#black-detail', 'In the game', 'result detail');
      assert.equal((await page.locator('.page-shell').textContent()).includes(RESULT_PAYLOAD), false, 'hostile result must not reach the rendered page');

      const summaryNames = await page.locator('#summary .summary-player strong').evaluateAll(strongs => strongs.map(strong => strong.textContent));
      assert.deepEqual(summaryNames, [WHITE_TOGGLE_PAYLOAD, BLACK_IFRAME_PAYLOAD]);

      await assertInert(page, 'breakout payloads');
    } finally {
      await page.close();
    }
  });
});
