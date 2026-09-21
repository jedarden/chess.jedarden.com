import { Chess } from 'chess.js';

const PIECE_POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function parseGame(input) {
  const notation = input.trim();
  if (!notation) throw new Error('Paste a game or choose a PGN file first.');
  const chess = new Chess();
  try {
    chess.loadPgn(notation);
  } catch (error) {
    throw new Error(`The notation could not be read: ${error.message}`);
  }
  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('No moves were found in the notation.');
  const headers = chess.getHeaders();
  return {
    notation,
    moves,
    fens: [moves[0].before, ...moves.map(move => move.after)],
    white: headers.White && headers.White !== '?' ? headers.White : 'White',
    black: headers.Black && headers.Black !== '?' ? headers.Black : 'Black',
    result: headers.Result && headers.Result !== '*' ? headers.Result : '',
  };
}

export function expectedForSide(info) {
  if (!info) return 0.5;
  if (info.score.kind === 'mate') return info.score.value > 0 ? 1 : 0;
  if (info.wdl) return (info.wdl[0] + info.wdl[1] / 2) / 1000;
  return 1 / (1 + Math.exp(-info.score.value / 140));
}

export function whiteScore(info, fen) {
  if (!info) return null;
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  return { kind: info.score.kind, value: info.score.value * sign };
}

export function displayScore(score) {
  if (!score) return '—';
  if (score.kind === 'mate') return `${score.value > 0 ? '+' : '−'}M${Math.abs(score.value)}`;
  return `${score.value >= 0 ? '+' : '−'}${(Math.abs(score.value) / 100).toFixed(2)}`;
}

export function uciMove(uci) {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

export function moveToSan(fen, uci) {
  const move = uciMove(uci);
  if (!move) return null;
  try {
    return new Chess(fen).move(move)?.san ?? null;
  } catch {
    return null;
  }
}

export function materialBalance(fen) {
  let balance = 0;
  for (const character of fen.split(' ')[0]) {
    const value = PIECE_POINTS[character.toLowerCase()] ?? 0;
    balance += character === character.toUpperCase() ? value : -value;
  }
  return balance;
}

function isGoodSacrifice(move, afterResult, beforeExpected, actualExpected) {
  if (move.piece === 'p' || move.piece === 'k' || beforeExpected >= 0.9 || actualExpected < 0.43) return false;
  const reply = uciMove(afterResult?.bestMove);
  if (!reply || reply.to !== move.to) return false;
  const board = new Chess(move.after);
  let response;
  try { response = board.move(reply); } catch { return false; }
  if (!response?.captured) return false;
  const initialGain = PIECE_POINTS[move.captured] ?? 0;
  return (PIECE_POINTS[move.piece] - initialGain) >= 2;
}

export function classifyMove(move, beforeResult, afterResult) {
  if (!beforeResult?.first || !afterResult?.first) return null;
  const beforeExpected = expectedForSide(beforeResult.first);
  const actualExpected = 1 - expectedForSide(afterResult.first);
  const loss = Math.max(0, Math.min(1, beforeExpected - actualExpected));
  const playedUci = move.from + move.to + (move.promotion ?? '');
  const bestUci = beforeResult.bestMove;
  const best = playedUci === bestUci;
  const secondExpected = beforeResult.second ? expectedForSide(beforeResult.second) : null;
  let kind;
  if ((best || loss < 0.02) && isGoodSacrifice(move, afterResult, beforeExpected, actualExpected)) kind = 'brilliant';
  else if (best && secondExpected !== null && beforeExpected - secondExpected >= 0.10 && beforeExpected >= 0.40) kind = 'great';
  else if (best) kind = 'best';
  else if (beforeExpected >= 0.75 && actualExpected < 0.65 && loss >= 0.12) kind = 'miss';
  else if (loss < 0.025) kind = 'excellent';
  else if (loss < 0.06) kind = 'good';
  else if (loss < 0.12) kind = 'inaccuracy';
  else if (loss < 0.22) kind = 'mistake';
  else kind = 'blunder';
  return {
    kind,
    label: kind[0].toUpperCase() + kind.slice(1),
    loss,
    bestMove: moveToSan(move.before, bestUci),
    bestUci,
  };
}

export function gameSummary(game, classifications) {
  const summary = { w: { moves: 0, loss: 0, counts: {} }, b: { moves: 0, loss: 0, counts: {} } };
  game.moves.forEach((move, index) => {
    const quality = classifications[index + 1];
    if (!quality) return;
    const side = summary[move.color];
    side.moves++;
    side.loss += quality.loss;
    side.counts[quality.kind] = (side.counts[quality.kind] ?? 0) + 1;
  });
  for (const side of Object.values(summary)) {
    side.averageLoss = side.moves ? side.loss / side.moves : 0;
  }
  return summary;
}
