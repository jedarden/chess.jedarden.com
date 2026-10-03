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
    let createStockfish;
    try {
      ({ default: createStockfish } = await import(/* @vite-ignore */ engineUrl));
    } catch (error) {
      throw new Error(`The engine code could not load from ${engineUrl}. ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      engine = await createStockfish();
    } catch (error) {
      throw new Error(`The WebAssembly engine could not start. ${error instanceof Error ? error.message : String(error)}`);
    }
    engine.listen = onLine;
    engine.onError = error => self.postMessage({ type: 'error', message: `The engine reported an error while running: ${String(error)}` });
    const nnueUrl = '/engine/nn-61e7af4bb97d.nnue';
    let response;
    try {
      response = await fetch(nnueUrl);
    } catch (error) {
      throw new Error(`The engine data file could not load from ${nnueUrl}. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`The engine data file could not load from ${nnueUrl} (HTTP ${response.status}).`);
    const data = await response.arrayBuffer();
    if (!data.byteLength) throw new Error(`The engine data file at ${nnueUrl} was empty.`);
    try {
      engine.setNnueBuffer(new Uint8Array(data));
    } catch (error) {
      throw new Error(`The engine data file could not be initialized. ${error instanceof Error ? error.message : String(error)}`);
    }
    engine.uci('uci');
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

startEngine();
