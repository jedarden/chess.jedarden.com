let engine;
let active = null;
let lines = new Map();

function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' score ') || !line.includes(' pv ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!score) return null;
  const wdl = line.match(/\bwdl (\d+) (\d+) (\d+)/);
  const pv = line.split(' pv ')[1]?.trim().split(/\s+/) ?? [];
  return {
    depth,
    rank,
    score: { kind: score[1], value: Number(score[2]) },
    wdl: wdl ? wdl.slice(1).map(Number) : null,
    pv,
  };
}

function onLine(raw) {
  for (const line of String(raw).split(/\r?\n/)) {
    if (line === 'uciok') {
      engine.uci('setoption name Hash value 16');
      engine.uci('setoption name MultiPV value 2');
      engine.uci('setoption name UCI_ShowWDL value true');
      engine.uci('isready');
    } else if (line === 'readyok') {
      self.postMessage({ type: 'ready' });
    } else if (active && line.startsWith('info ')) {
      const info = parseInfo(line);
      if (info && info.depth >= (lines.get(info.rank)?.depth ?? 0)) lines.set(info.rank, info);
    } else if (active && line.startsWith('bestmove ')) {
      self.postMessage({ type: 'result', id: active.id, bestMove: line.split(' ')[1], first: lines.get(1) ?? null, second: lines.get(2) ?? null });
      active = null;
      lines = new Map();
    }
  }
}

self.onmessage = event => {
  const message = event.data;
  if (message.type === 'analyze' && engine && !active) {
    active = { id: message.id };
    lines = new Map();
    engine.uci(`position fen ${message.fen}`);
    engine.uci(`go depth ${message.depth}`);
  }
};

async function startEngine() {
try {
  const engineUrl = '/engine/sf_19_smallnet.js';
  const { default: createStockfish } = await import(/* @vite-ignore */ engineUrl);
  engine = await createStockfish();
  engine.listen = onLine;
  engine.onError = error => self.postMessage({ type: 'error', message: String(error) });
  const response = await fetch('/engine/nn-61e7af4bb97d.nnue');
  if (!response.ok) throw new Error(`Engine data HTTP ${response.status}`);
  engine.setNnueBuffer(new Uint8Array(await response.arrayBuffer()));
  engine.uci('uci');
} catch (error) {
  self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
}

startEngine();
