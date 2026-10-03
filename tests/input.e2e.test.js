import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Chess } from 'chess.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const testPgn = `[Event "Browser input test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *`;

async function runnableBrowser() {
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
      return candidate;
    } catch {
      // A browser binary can exist while its host is missing a shared library.
    }
  }
  return null;
}

function positionsFor(source) {
  const chess = new Chess();
  chess.loadPgn(source);
  const moves = chess.history({ verbose: true });
  return {
    moves,
    occupiedSquares: [moves[0].before, ...moves.map(move => move.after)].map(fen => {
      const squares = [];
      for (const [rankIndex, rank] of fen.split(' ')[0].split('/').entries()) {
        let file = 0;
        for (const character of rank) {
          if (/\d/.test(character)) file += Number(character);
          else {
            squares.push(`${String.fromCharCode(97 + file)}${8 - rankIndex}`);
            file++;
          }
        }
      }
      return squares.sort();
    }),
  };
}

const executable = await runnableBrowser();

describe('documented game-input methods', { skip: executable ? false : 'No Chromium executable found; set CHESS_BROWSER_PATH to run browser tests.' }, () => {
  let browser;
  let server;
  let baseUrl;

  before(async () => {
    await execFileAsync(process.execPath, ['scripts/prepare-engine.mjs'], { cwd: root });
    server = await createServer({ configFile: resolve(root, 'vite.config.js'), server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: executable, headless: true });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  async function openPage() {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/`);
    await page.locator('#notation').waitFor();
    return page;
  }

  async function analyzeInput(page, source) {
    const expected = positionsFor(source);
    await page.locator('#notation').fill(source);
    await page.locator('#depth').selectOption('8');
    await page.locator('#analyze').click();
    await page.waitForFunction(moveCount => document.querySelector('#move-index')?.textContent === `0 / ${moveCount}`, expected.moves.length);
    assert.equal(await page.locator('#input-error').getAttribute('hidden'), '');
    if (await page.locator('#cancel').isVisible()) await page.locator('#cancel').click();
    return expected;
  }

  test('mounts the Agentation feedback toolbar', async () => {
    const page = await openPage();
    try {
      const importMap = JSON.parse(await page.locator('script[type="importmap"]').textContent());
      assert.deepEqual(importMap, {
        imports: {
          react: 'https://esm.sh/react@18.3.1',
          'react-dom': 'https://esm.sh/react-dom@18.3.1',
          'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
          'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
        },
      });
      assert.equal(await page.evaluate(() => Boolean(document.getElementById('agentation-root'))), true);
      await page.locator('[data-feedback-toolbar]').waitFor({ state: 'attached', timeout: 15000 });
      assert.ok(await page.locator('[data-feedback-toolbar]').count() > 0, 'Agentation toolbar should render');
    } finally {
      await page.close();
    }
  });

  async function replayEveryMove(page, expected) {
    for (let index = 0; index <= expected.moves.length; index++) {
      await page.waitForFunction(position => document.querySelector('#move-index')?.textContent?.startsWith(`${position} / `), index);
      const occupied = await page.locator('#board .piece').evaluateAll(elements => elements.map(element => element.dataset.square).sort());
      assert.deepEqual(occupied, expected.occupiedSquares[index], `occupied squares after position ${index}`);
      const replayPosition = await page.locator('#replay-position').textContent();
      const move = expected.moves[index - 1];
      assert.equal(replayPosition, move ? `${Math.ceil(index / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position');
      if (index < expected.moves.length) await page.locator('#next').click();
    }
    assert.equal(await page.locator('#next').isDisabled(), true);
  }

  test('pastes numbered moves and legally replays every move', async () => {
    const page = await openPage();
    try {
      const expected = await analyzeInput(page, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7');
      assert.equal(await page.locator('#white-name').textContent(), 'White');
      assert.equal(await page.locator('#black-name').textContent(), 'Black');
      await replayEveryMove(page, expected);
    } finally {
      await page.close();
    }
  });

  test('offers the documented selectable analysis depths', async () => {
    const page = await openPage();
    try {
      assert.deepEqual(await page.locator('#depth option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent }))), [
        { value: '8', label: 'Quick · depth 8' },
        { value: '12', label: 'Balanced · depth 12' },
        { value: '16', label: 'Deep · depth 16' },
      ]);
      assert.equal(await page.locator('#depth').inputValue(), '12');
      await page.locator('#depth').selectOption('8');
      assert.equal(await page.locator('#depth').inputValue(), '8');
      await page.locator('#depth').selectOption('16');
      assert.equal(await page.locator('#depth').inputValue(), '16');
    } finally {
      await page.close();
    }
  });

  test('pastes PGN headers and legally replays every move', async () => {
    const page = await openPage();
    try {
      const expected = await analyzeInput(page, testPgn);
      assert.equal(await page.locator('#white-name').textContent(), 'Alice');
      assert.equal(await page.locator('#black-name').textContent(), 'Bob');
      await replayEveryMove(page, expected);
    } finally {
      await page.close();
    }
  });

  test('keeps game notation in the browser during analysis', async () => {
    const page = await browser.newPage();
    const requests = [];
    const privateGame = `[Event "Browser Privacy Canary 7f4d2c"]
[White "Notation Stays Local"]
[Black "Network Must Not See This"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *`;

    page.on('request', request => requests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      postData: request.postData(),
    }));

    try {
      await page.goto(`${baseUrl}/`);
      await page.locator('#notation').waitFor();
      await page.locator('#notation').fill(privateGame);
      await page.locator('#depth').selectOption('8');
      await page.locator('#analyze').click();
      await page.waitForFunction(() => document.querySelector('#progress-label')?.textContent === 'Analysis complete', null, { timeout: 60000 });

      const appOrigin = new URL(baseUrl).origin;
      const staticFetches = new Set(['/engine/nn-61e7af4bb97d.nnue', '/engine/sf_19_smallnet.wasm']);
      const nonStaticRequests = requests.filter(request => {
        const url = new URL(request.url);
        const dynamicResource = ['fetch', 'xhr', 'websocket'].includes(request.resourceType)
          && !staticFetches.has(url.pathname);
        return url.origin !== appOrigin || request.method !== 'GET' || request.postData !== null || dynamicResource;
      });
      assert.deepEqual(nonStaticRequests, [], 'analysis should only make same-origin static GET requests');

      const wireData = requests.map(request => `${request.url}\n${request.postData ?? ''}`).join('\n');
      assert.equal(decodeURIComponent(wireData.replaceAll('+', ' ')).includes(privateGame), false, 'game notation must not appear in request URLs or bodies');
      assert.equal(await page.locator('#input-error').getAttribute('hidden'), '');
      assert.equal(await page.locator('#progress-count').textContent(), '5 / 5');
    } finally {
      await page.close();
    }
  });

  test('uploads a .pgn file and legally replays every move', async () => {
    const page = await openPage();
    try {
      await page.locator('#pgn-file').setInputFiles({
        name: 'browser-input.pgn',
        mimeType: 'application/x-chess-pgn',
        buffer: Buffer.from(testPgn),
      });
      assert.equal(await page.locator('#notation').inputValue(), testPgn);
      const expected = await analyzeInput(page, testPgn);
      await replayEveryMove(page, expected);
    } finally {
      await page.close();
    }
  });

  test('shows an error and leaves the board empty for malformed input', async () => {
    const page = await openPage();
    try {
      await page.locator('#notation').fill('1. e4 e5 2. not-a-legal-move');
      await page.locator('#analyze').click();
      await page.locator('#input-error').waitFor({ state: 'visible' });
      assert.match(await page.locator('#input-error').textContent(), /could not be read/);
      assert.equal(await page.locator('#move-index').textContent(), '0 / 0');
      assert.equal(await page.locator('#board .piece').count(), 32);
    } finally {
      await page.close();
    }
  });

  test('explains a failed engine asset load while keeping the game replayable', async () => {
    const page = await openPage();
    await page.route('**/engine/nn-61e7af4bb97d.nnue', route => route.fulfill({ status: 503, body: 'temporarily unavailable' }));
    try {
      await page.locator('#notation').fill('1. e4');
      await page.locator('#depth').selectOption('8');
      await page.locator('#analyze').click();
      await page.locator('#input-error').waitFor({ state: 'visible', timeout: 15000 });
      assert.match(await page.locator('#input-error').textContent(), /engine data file|engine analysis could not start/i);
      assert.match(await page.locator('#input-error').textContent(), /replay/i);
      assert.equal(await page.locator('#move-index').textContent(), '0 / 1');
      assert.equal(await page.locator('#next').isDisabled(), false);
    } finally {
      await page.close();
    }
  });
});
