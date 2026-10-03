export const ENGINE_ASSET_PATHS = Object.freeze([
  '/engine-worker.js',
  '/engine/sf_19_smallnet.js',
  '/engine/sf_19_smallnet.wasm',
  '/engine/nn-61e7af4bb97d.nnue',
]);

export function getEngineCompatibility(environment = globalThis) {
  if (environment.isSecureContext !== true) {
    return {
      ok: false,
      code: 'secure-context',
      message: 'Engine analysis needs a secure context (HTTPS; localhost is supported for development).',
    };
  }
  if (environment.crossOriginIsolated !== true) {
    return {
      ok: false,
      code: 'cross-origin-isolation',
      message: 'Engine analysis needs a cross-origin-isolated page. This deployment must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.',
    };
  }
  if (typeof environment.SharedArrayBuffer !== 'function') {
    return {
      ok: false,
      code: 'shared-array-buffer',
      message: 'This browser does not provide SharedArrayBuffer, which the local chess engine needs. Try a current browser over HTTPS.',
    };
  }
  if (typeof environment.Worker !== 'function') {
    return {
      ok: false,
      code: 'worker',
      message: 'This browser does not support Web Workers, which the local chess engine needs.',
    };
  }
  if (!environment.WebAssembly || typeof environment.WebAssembly.instantiate !== 'function') {
    return {
      ok: false,
      code: 'webassembly',
      message: 'This browser does not support WebAssembly, which the local chess engine needs.',
    };
  }
  return { ok: true, code: null, message: '' };
}

export function formatEngineFailure(error) {
  const detail = error instanceof Error ? error.message : String(error || 'The engine returned an unknown error.');
  return `Engine analysis could not start. ${detail} Check that this page is cross-origin isolated and that its required engine files are available, then reload and try again. Your parsed game remains available for replay.`;
}
