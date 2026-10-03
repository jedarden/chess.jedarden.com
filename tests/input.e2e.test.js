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
    server = await createServer({ configFile: resolve(root, 'vite.config.js'), server: { host: '127.0.0.1', port: 0 } });
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
});
