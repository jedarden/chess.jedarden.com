import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGame, expectedForSide, whiteScore, displayScore, classifyMove, materialBalance, gameSummary } from '../src/analysis.js';
import { formatEngineFailure, getEngineCompatibility } from '../src/engine-support.js';

const cp = (value, wdl = null) => ({ score: { kind: 'cp', value }, wdl });
const result = (first, bestMove, second = null) => ({ first, bestMove, second });
const expected = value => cp(0, [value * 1000, 0, (1 - value) * 1000]);

test('reads a numbered game through checkmate and preserves every position', () => {
  const game = parseGame('[White "A"]\n[Black "B"]\n\n1. f3 e5 2. g4 Qh4# 0-1');
  assert.equal(game.moves.length, 4);
  assert.equal(game.fens.length, 5);
  assert.equal(game.moves.at(-1).san, 'Qh4#');
  assert.equal(game.white, 'A');
  assert.equal(game.black, 'B');
  assert.equal(game.result, '0-1');
});

test('rejects malformed notation without inventing moves', () => {
  assert.throws(() => parseGame('1. e4 e5 2. What'), /could not be read/);
  assert.throws(() => parseGame('  '), /Paste a game/);
});

test('keeps engine scores in White perspective', () => {
  const game = parseGame('1. e4 e5');
  assert.deepEqual(whiteScore(cp(-83), game.fens[1]), { kind: 'cp', value: 83 });
  assert.deepEqual(whiteScore(cp(-83), game.fens[0]), { kind: 'cp', value: -83 });
  assert.equal(displayScore(whiteScore(cp(-83), game.fens[1])), '+0.83');
  assert.equal(displayScore(whiteScore(cp(-83), game.fens[0])), '−0.83');
  assert.equal(whiteScore(null, game.fens[0]), null);
  assert.equal(materialBalance(game.fens[2]), 0);
});

test('formats centipawn and forced-mate scores', () => {
  assert.equal(displayScore(null), '—');
  assert.equal(displayScore({ kind: 'cp', value: 0 }), '+0.00');
  assert.equal(displayScore({ kind: 'cp', value: 125 }), '+1.25');
  assert.equal(displayScore({ kind: 'cp', value: -125 }), '−1.25');
  assert.equal(displayScore({ kind: 'mate', value: 3 }), '+M3');
  assert.equal(displayScore({ kind: 'mate', value: -7 }), '−M7');

  const game = parseGame('1. e4');
  assert.deepEqual(whiteScore({ score: { kind: 'mate', value: 3 } }, game.fens[0]), { kind: 'mate', value: 3 });
  assert.deepEqual(whiteScore({ score: { kind: 'mate', value: 3 } }, game.fens[1]), { kind: 'mate', value: -3 });
  assert.equal(expectedForSide({ score: { kind: 'mate', value: 1 }, wdl: [0, 0, 1000] }), 1);
  assert.equal(expectedForSide({ score: { kind: 'mate', value: -1 }, wdl: [1000, 0, 0] }), 0);
});

test('uses WDL first and falls back to a centipawn logistic curve', () => {
  assert.equal(expectedForSide(cp(20, [400, 300, 300])), 0.55);
  assert.equal(expectedForSide(cp(140)), 1 / (1 + Math.exp(-1)));
  assert.equal(expectedForSide(null), 0.5);
});

test('labels a clear score drop and accumulates each side separately', () => {
  const game = parseGame('1. f3 e5');
  const before = result(cp(0, [300, 400, 300]), 'e2e4', cp(-10, [280, 400, 320]));
  const after = result(cp(300, [900, 70, 30]), 'e7e5');
  const quality = classifyMove(game.moves[0], before, after);
  assert.equal(quality.kind, 'blunder');
  const summary = gameSummary(game, [null, quality, null]);
  assert.equal(summary.w.moves, 1);
  assert.equal(summary.b.moves, 0);
  assert.equal(summary.w.counts.blunder, 1);
});

test('recognizes a unique best move', () => {
  const game = parseGame('1. e4');
  const before = result(cp(0, [300, 400, 300]), 'e2e4', cp(-160, [140, 400, 460]));
  const after = result(cp(0, [300, 400, 300]), 'e7e5');
  assert.equal(classifyMove(game.moves[0], before, after).kind, 'great');
});

test('uses both principal variations for Best versus Great', () => {
  const game = parseGame('1. e4');
  const after = result(expected(0.5), 'e7e5');

  const great = classifyMove(
    game.moves[0],
    result(expected(0.5), 'e2e4', expected(0.34)),
    after,
  );
  assert.equal(great.kind, 'great');
  assert.equal(great.label, 'Great');
  assert.equal(great.bestUci, 'e2e4');
  assert.equal(great.bestMove, 'e4');

  const best = classifyMove(
    game.moves[0],
    result(expected(0.5), 'e2e4', expected(0.46)),
    after,
  );
  assert.equal(best.kind, 'best');
  assert.equal(best.label, 'Best');
});

test('assigns every documented move label at its expected threshold', () => {
  const game = parseGame('1. e4');
  const move = game.moves[0];
  const cases = [
    ['Best', result(expected(0.5), 'e2e4'), expected(0.5)],
    ['Excellent', result(expected(0.5), 'd2d4'), expected(0.51)],
    ['Good', result(expected(0.5), 'd2d4'), expected(0.53)],
    ['Inaccuracy', result(expected(0.5), 'd2d4'), expected(0.58)],
    ['Mistake', result(expected(0.5), 'd2d4'), expected(0.66)],
    ['Blunder', result(expected(0.5), 'd2d4'), expected(0.73)],
    ['Miss', result(expected(0.8), 'd2d4'), expected(0.7)],
  ];

  for (const [label, before, afterFirst] of cases) {
    const quality = classifyMove(move, before, result(afterFirst, 'e7e5'));
    assert.equal(quality.label, label, `${label} should be selected`);
    assert.equal(quality.bestMove, label === 'Best' ? 'e4' : 'd4', `${label} should explain the preferred move`);
  }
});

test('recognizes a sound piece sacrifice as Brilliant', () => {
  const game = parseGame('1. e4 e5 2. Bc4 Nf6 3. Bxf7+');
  const move = game.moves.at(-1);
  const quality = classifyMove(
    move,
    result(expected(0.5), 'c4f7', expected(0.5)),
    result(expected(0.5), 'e8f7'),
  );
  assert.equal(quality.kind, 'brilliant');
  assert.equal(quality.label, 'Brilliant');
  assert.equal(quality.bestMove, 'Bxf7+');
});

test('summarizes reviewed decisions independently for each side', () => {
  const game = parseGame('1. e4 e5 2. Nf3 Nc6');
  const classifications = [
    null,
    { kind: 'good', loss: 0.1 },
    { kind: 'mistake', loss: 0.2 },
    { kind: 'best', loss: 0 },
    null,
  ];
  const summary = gameSummary(game, classifications);

  assert.deepEqual(summary.w, {
    moves: 2,
    loss: 0.1,
    counts: { good: 1, best: 1 },
    averageLoss: 0.05,
  });
  assert.deepEqual(summary.b, {
    moves: 1,
    loss: 0.2,
    counts: { mistake: 1 },
    averageLoss: 0.2,
  });
});

test('describes the browser prerequisites for local engine analysis', () => {
  const supported = {
    isSecureContext: true,
    crossOriginIsolated: true,
    SharedArrayBuffer: class SharedArrayBuffer {},
    Worker: class Worker {},
    WebAssembly: { instantiate() {} },
  };
  assert.deepEqual(getEngineCompatibility(supported), { ok: true, code: null, message: '' });
  assert.equal(getEngineCompatibility({ ...supported, crossOriginIsolated: false }).code, 'cross-origin-isolation');
  assert.equal(getEngineCompatibility({ ...supported, SharedArrayBuffer: undefined }).code, 'shared-array-buffer');
  assert.equal(getEngineCompatibility({ ...supported, isSecureContext: false }).code, 'secure-context');
  assert.match(formatEngineFailure(new Error('The engine data file could not load (HTTP 503).')), /required engine files/);
});
