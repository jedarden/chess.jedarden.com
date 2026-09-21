import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('node_modules/@lichess-org/stockfish-web');
const target = resolve('public/engine');
await mkdir(target, { recursive: true });
for (const file of ['sf_19_smallnet.js', 'sf_19_smallnet.wasm']) {
  await copyFile(resolve(source, file), resolve(target, file));
}
