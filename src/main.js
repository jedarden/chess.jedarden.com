import React from 'react';
import { createRoot } from 'react-dom/client';
import { Agentation } from 'agentation';
import { Chess } from 'chess.js';
import pieces from './pieces.json';
import { parseGame, whiteScore, displayScore, materialBalance, classifyMove, gameSummary } from './analysis.js';
import './style.css';

createRoot(document.getElementById('agentation-root')).render(React.createElement(Agentation));

const SAMPLE = `[White "You"]\n[Black "Jev"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Nc3 Bc5 4. d3 Nf6 5. f4 O-O 6. Nf3 Qe7 7. Qe2 d5 8. exd5 Nd4 9. Nxd4 Bxd4 10. Nb5 Bg4 11. Qd2 exf4+ 12. Kf1 Be3 13. Qe1 Rfd8 14. Bxe3 fxe3 15. Qg3 e2+ 16. Ke1 Qb4+ 17. c3 Qc5 18. b3 Re8 19. d4 Qb6 20. Nxc7 Rac8 21. Nxe8 Rxe8 22. h3 Bf5 23. Bxe2 Nxd5 24. Qg5 Ne3 25. g4 Nc2+ 26. Kd2 Nxa1 27. Rxa1 Bg6 28. h4 Qd6 29. h5 Be4 30. Bd3 Bxd3 31. Kxd3 Qh2 32. Re1 Rxe1 33. Qd8+ Re8 34. Qxe8# 1-0`;

const $ = id => document.getElementById(id);
const board = $('board');
let game = null;
let index = 0;
let flipped = false;
let playing = false;
let playTimer = null;
let worker = null;
let run = 0;
let evaluations = [];
let qualities = [];

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function squarePlace(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return { col: flipped ? 7 - file : file, row: flipped ? rank : 7 - rank };
}

function stopPlayback() {
  playing = false;
  clearTimeout(playTimer);
  $('play').innerHTML = '▶ <span>Play</span>';
  $('play').setAttribute('aria-label', 'Play animation');
}

function renderBoard(previous = null, animated = false) {
  const position = new Chess(game ? game.fens[index] : undefined);
  const move = game && index ? game.moves[index - 1] : null;
  const parts = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = String.fromCharCode(97 + (flipped ? 7 - col : col));
      const rank = flipped ? row + 1 : 8 - row;
      const square = `${file}${rank}`;
      const dark = (col + row) % 2 === 1;
      const last = move && (square === move.from || square === move.to);
      const check = position.isCheck() && position.get(square)?.type === 'k' && position.get(square)?.color === position.turn();
      parts.push(`<div class="square ${dark ? 'dark' : 'light'}${last ? ' last' : ''}${check ? ' check' : ''}" style="left:${col * 12.5}%;top:${row * 12.5}%">${col === 0 ? `<span class="coordinate rank">${rank}</span>` : ''}${row === 7 ? `<span class="coordinate file">${file}</span>` : ''}</div>`);
      const piece = position.get(square);
      if (piece) {
        const key = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        parts.push(`<div class="piece" data-square="${square}" style="left:${col * 12.5}%;top:${row * 12.5}%">${pieces[key]}</div>`);
      }
    }
  }
  board.innerHTML = parts.join('');
  board.setAttribute('aria-label', `Chessboard from ${flipped ? 'Black' : 'White'}'s perspective, ${index ? `after ${move.san}` : 'starting position'}`);
  if (animated && previous !== null && index === previous + 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const dest = board.querySelector(`.piece[data-square="${move.to}"]`);
    if (dest) {
      const from = squarePlace(move.from);
      const to = squarePlace(move.to);
      dest.animate([{ transform: `translate(${(from.col - to.col) * 100}%, ${(from.row - to.row) * 100}%)`, zIndex: 4 }, { transform: 'translate(0, 0)', zIndex: 4 }], { duration: 330, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

function scoreAt(i) {
  return game && evaluations[i]?.first ? whiteScore(evaluations[i].first, game.fens[i]) : null;
}

function renderInsight() {
  const score = scoreAt(index);
  $('score-value').textContent = displayScore(score);
  $('score-value').className = `score-value ${score ? score.value > 0 ? 'positive' : score.value < 0 ? 'negative' : '' : ''}`;
  $('score-side').textContent = !score ? 'Awaiting analysis' : score.kind === 'mate' ? `Forced mate: ${score.value > 0 ? game.white : game.black}` : score.value > 20 ? `Advantage: ${game.white}` : score.value < -20 ? `Advantage: ${game.black}` : 'Roughly even';
  const cp = score ? score.kind === 'mate' ? Math.sign(score.value) * 1200 : score.value : 0;
  $('eval-rail-fill').style.height = `${Math.round(50 + 49 * Math.tanh(cp / 320))}%`;
  const balance = game ? materialBalance(game.fens[index]) : 0;
  $('material').textContent = balance === 0 ? 'Even' : `${balance > 0 ? 'White' : 'Black'} +${Math.abs(balance)}`;
  $('move-index').textContent = `${index} / ${game?.moves.length ?? 0}`;
  $('turn-tag').textContent = index ? game.moves[index - 1].color === 'w' ? 'WHITE MOVED' : 'BLACK MOVED' : 'START';
  const quality = qualities[index];
  $('quality-pill').textContent = !index ? 'Starting position' : quality?.label ?? (evaluations[index] ? 'Evaluated' : 'Awaiting analysis');
  $('quality-pill').className = `quality-pill ${quality?.kind ?? 'waiting'}`;
  const move = index && game ? game.moves[index - 1] : null;
  $('insight-text').textContent = !game ? 'Enter notation to see the game. Run analysis to compare each move with the engine’s preferred continuation.'
    : !move ? 'The game begins here. Step through the moves or press Play.'
      : !quality ? `${move.color === 'w' ? game.white : game.black} played ${move.san}. ${evaluations[index] ? 'The position is evaluated; the move label is still being calculated.' : 'Analysis is on its way.'}`
        : `${move.color === 'w' ? game.white : game.black} played ${move.san}. ${quality.kind === 'best' ? 'This matched the engine’s top choice.' : quality.kind === 'brilliant' ? 'A sound piece offer that the engine favors.' : quality.kind === 'great' ? 'A standout choice with much weaker alternatives.' : `Estimated score lost: ${(quality.loss * 100).toFixed(1)} percentage points.`}`;
  $('best-line').textContent = quality?.bestMove && quality.bestMove !== move?.san ? `Engine preferred ${quality.bestMove}` : '';
  $('replay-position').textContent = move ? `${Math.ceil(index / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position';
  $('black-detail').textContent = game ? index ? index === game.moves.length && game.result ? game.result : 'In the game' : 'Ready to play' : 'Waiting for a game';
  $('white-detail').textContent = game ? `${game.moves.length} half moves` : 'Ready to begin';
}

function graphY(score) {
  if (!score) return 105;
  const pawns = score.kind === 'mate' ? Math.sign(score.value) * 8 : score.value / 100;
  return 105 - Math.tanh(pawns / 3.5) * 80;
}

function renderGraph() {
  const svg = $('eval-chart');
  const count = game?.moves.length ?? 0;
  const x = i => 24 + (count ? i / count : 0) * 612;
  const points = evaluations.map((result, i) => result?.first ? `${x(i).toFixed(1)},${graphY(scoreAt(i)).toFixed(1)}` : null);
  const valid = points.filter(Boolean);
  let html = `<line class="chart-axis" x1="24" y1="105" x2="636" y2="105"/><text class="chart-label" x="25" y="21">WHITE +</text><text class="chart-label" x="25" y="201">BLACK +</text><path class="chart-track" d="M24 105H636"/>`;
  if (valid.length > 1) html += `<polyline class="chart-progress" points="${valid.join(' ')}"/>`;
  if (game) html += `<line class="chart-cursor" x1="${x(index)}" y1="18" x2="${x(index)}" y2="192"/><circle class="chart-dot" cx="${x(index)}" cy="${graphY(scoreAt(index))}" r="5"/>`;
  svg.innerHTML = html;
}

function renderMoves() {
  if (!game) return;
  $('move-count-label').textContent = `${Math.ceil(game.moves.length / 2)} MOVES`;
  const rows = [];
  for (let i = 0; i < game.moves.length; i += 2) {
    const button = j => j < game.moves.length ? `<button class="move-button${index === j + 1 ? ' active' : ''}" data-index="${j + 1}" type="button" title="${esc(qualities[j + 1]?.label ?? 'Awaiting analysis')}"><span>${esc(game.moves[j].san)}</span><i class="mini-quality ${qualities[j + 1]?.kind ?? ''}"></i></button>` : '';
    rows.push(`<div class="move-row"><span class="move-number">${Math.floor(i / 2) + 1}.</span>${button(i)}${button(i + 1)}</div>`);
  }
  $('move-list').innerHTML = rows.join('');
  $('move-list').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function renderSummary() {
  if (!game) return;
  const summary = gameSummary(game, qualities);
  const card = (name, side) => `<div class="summary-player"><small>${side === 'w' ? 'WHITE' : 'BLACK'}</small><strong>${esc(name)}</strong><span class="big-number">${summary[side].moves ? (summary[side].averageLoss * 100).toFixed(1) + '%' : '—'}</span><span>average expected score lost · ${summary[side].moves} moves reviewed</span></div>`;
  $('summary').innerHTML = `<div class="summary-players">${card(game.white, 'w')}${card(game.black, 'b')}</div><p class="summary-note">Lower is better. Labels and percentages are depth dependent estimates, not a player rating.</p>`;
}

function render(previous = null, animate = false) {
  renderBoard(previous, animate);
  renderInsight();
  renderGraph();
  renderMoves();
  renderSummary();
  $('scrubber').max = game?.moves.length ?? 0;
  $('scrubber').value = index;
  $('first').disabled = $('previous').disabled = index === 0;
  $('next').disabled = $('last').disabled = !game || index === game.moves.length;
  $('play').disabled = !game || !game.moves.length;
}

function seek(target, animate = false) {
  if (!game) return;
  const previous = index;
  index = Math.max(0, Math.min(game.moves.length, target));
  render(previous, animate);
  if (index === game.moves.length) stopPlayback();
}

function playbackTick() {
  if (!playing || !game) return;
  seek(index + 1, true);
  if (playing) playTimer = setTimeout(playbackTick, 690);
}

function stopAnalysis() {
  run++;
  worker?.terminate();
  worker = null;
  $('analyze').disabled = false;
  $('cancel').hidden = true;
  if (!$('progress-wrap').hidden && $('progress-label').textContent !== 'Analysis complete') $('progress-label').textContent = 'Analysis stopped';
}

function terminalResult(fen) {
  const chess = new Chess(fen);
  if (!chess.isGameOver()) return null;
  return chess.isCheckmate()
    ? { bestMove: null, first: { score: { kind: 'mate', value: -1 }, wdl: [0, 0, 1000] }, second: null }
    : { bestMove: null, first: { score: { kind: 'cp', value: 0 }, wdl: [0, 1000, 0] }, second: null };
}

function analyzeFen(w, id, fen, depth) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('The engine took too long for this position. Try Quick analysis.')); }, 90000);
    const onMessage = event => {
      const data = event.data;
      if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
      if (data.type === 'result' && data.id === id) { cleanup(); resolve(data); }
    };
    const onError = event => { cleanup(); reject(new Error(event.message || 'The analysis worker failed.')); };
    function cleanup() { clearTimeout(timeout); w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); }
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ type: 'analyze', id, fen, depth });
  });
}

async function analyzeGame() {
  stopAnalysis();
  stopPlayback();
  $('input-error').hidden = true;
  try { game = parseGame($('notation').value); }
  catch (error) { $('input-error').textContent = error.message; $('input-error').hidden = false; return; }
  index = 0;
  evaluations = Array(game.fens.length).fill(null);
  qualities = Array(game.fens.length).fill(null);
  $('white-name').textContent = game.white;
  $('black-name').textContent = game.black;
  $('progress-wrap').hidden = false;
  $('progress-label').textContent = 'Loading engine…';
  $('progress-count').textContent = `0 / ${game.fens.length}`;
  $('progress-fill').style.width = '0%';
  $('analyze').disabled = true;
  $('cancel').hidden = false;
  render();
  const myRun = ++run;
  const depth = Number($('depth').value);
  try {
    const w = new Worker('/engine-worker.js', { type: 'module' });
    worker = w;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('The engine could not start. Reload and try again.')); }, 30000);
      const onMessage = event => {
        if (event.data.type === 'ready') { cleanup(); resolve(); }
        if (event.data.type === 'error') { cleanup(); reject(new Error(event.data.message)); }
      };
      const onError = event => { cleanup(); reject(new Error(event.message || 'The engine could not start.')); };
      function cleanup() { clearTimeout(timeout); w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); }
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
    });
    if (myRun !== run) return;
    for (let i = 0; i < game.fens.length; i++) {
      const terminal = terminalResult(game.fens[i]);
      evaluations[i] = terminal ?? await analyzeFen(w, i, game.fens[i], depth);
      if (myRun !== run) return;
      if (i > 0) qualities[i] = classifyMove(game.moves[i - 1], evaluations[i - 1], evaluations[i]);
      $('progress-label').textContent = i === game.moves.length ? 'Analysis complete' : `Evaluating position ${i + 1}`;
      $('progress-count').textContent = `${i + 1} / ${game.fens.length}`;
      $('progress-fill').style.width = `${((i + 1) / game.fens.length) * 100}%`;
      renderInsight(); renderGraph(); renderMoves(); renderSummary();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (myRun === run) { w.terminate(); worker = null; $('analyze').disabled = false; $('cancel').hidden = true; }
  } catch (error) {
    if (myRun === run) { stopAnalysis(); $('input-error').textContent = error.message; $('input-error').hidden = false; $('progress-label').textContent = 'Analysis interrupted'; }
  }
}

$('analyze').addEventListener('click', analyzeGame);
$('cancel').addEventListener('click', stopAnalysis);
$('sample').addEventListener('click', () => { $('notation').value = SAMPLE; $('notation').focus(); });
$('pgn-file').addEventListener('change', async event => { const file = event.target.files?.[0]; if (file) $('notation').value = await file.text(); });
$('flip-board').addEventListener('click', () => { flipped = !flipped; render(); });
$('first').addEventListener('click', () => { stopPlayback(); seek(0); });
$('previous').addEventListener('click', () => { stopPlayback(); seek(index - 1); });
$('next').addEventListener('click', () => { stopPlayback(); seek(index + 1, true); });
$('last').addEventListener('click', () => { stopPlayback(); seek(game?.moves.length ?? 0); });
$('play').addEventListener('click', () => {
  if (playing) { stopPlayback(); return; }
  if (!game) return;
  if (index === game.moves.length) seek(0);
  playing = true;
  $('play').innerHTML = 'Ⅱ <span>Pause</span>';
  $('play').setAttribute('aria-label', 'Pause animation');
  playbackTick();
});
$('scrubber').addEventListener('input', event => { stopPlayback(); seek(Number(event.target.value)); });
$('move-list').addEventListener('click', event => { const button = event.target.closest('button[data-index]'); if (button) { stopPlayback(); seek(Number(button.dataset.index)); } });
$('eval-chart').addEventListener('click', event => { if (!game) return; const rect = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width * 660; stopPlayback(); seek(Math.round((x - 24) / 612 * game.moves.length)); });
document.addEventListener('keydown', event => {
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); stopPlayback(); seek(index + 1, true); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); stopPlayback(); seek(index - 1); }
  if (event.key === ' ' && game) { event.preventDefault(); $('play').click(); }
});
$('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('chess-workbench-theme', next);
});
const theme = localStorage.getItem('chess-workbench-theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
render();
