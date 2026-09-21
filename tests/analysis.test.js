import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGame, expectedForSide, whiteScore, displayScore, classifyMove, materialBalance, gameSummary } from '../src/analysis.js';

const cp = (value, wdl = null) => ({ score: { kind: 'cp', value }, wdl });
const result = (first, bestMove, second = null) => ({ first, bestMove, second });

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

test('keeps engine score in white perspective', () => {
  const game = parseGame('1. e4 e5');
  assert.deepEqual(whiteScore(cp(-83), game.fens[1]), { kind: 'cp', value: 83 });
  assert.equal(displayScore(whiteScore(cp(-83), game.fens[1])), '+0.83');
  assert.equal(materialBalance(game.fens[2]), 0);
  assert.equal(expectedForSide(cp(20, [400, 300, 300])), 0.55);
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
