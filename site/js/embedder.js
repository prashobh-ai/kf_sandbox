// ============================================================================
// Semantic embedder — runs the query embedding model fully in the browser.
//
// Loads transformers.js + Xenova/all-MiniLM-L6-v2 (~23 MB, WASM, no WebGPU
// required) from a CDN on demand. Chunk vectors are precomputed at build time
// and shipped in index.json; here we only embed the *query* and score it
// against them. Everything is best-effort: if the model can't load, callers
// fall back to keyword (BM25) retrieval.
// ============================================================================

const TRANSFORMERS_CDN =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

let _pipelinePromise = null;
let _status = 'idle'; // idle | loading | ready | failed
const _listeners = new Set();

export function onEmbedderStatus(fn) {
  _listeners.add(fn);
  fn(_status);
  return () => _listeners.delete(fn);
}
function setStatus(s) {
  _status = s;
  for (const fn of _listeners) fn(s);
}
export function embedderStatus() {
  return _status;
}

// ---------------------------------------------------------------------------
// Chunk matrix — decode the int8 embeddings block from index.json
// ---------------------------------------------------------------------------
export function decodeChunkMatrix(embeddings) {
  if (!embeddings || !embeddings.data) return null;
  const { dim, count, scale } = embeddings;
  const bin = atob(embeddings.data);
  const n = bin.length;
  const int8 = new Int8Array(n);
  for (let i = 0; i < n; i++) int8[i] = (bin.charCodeAt(i) << 24) >> 24; // to signed
  const inv = 1 / (scale || 127);
  // Store as normalized Float32 rows for fast dot products.
  const mat = new Float32Array(count * dim);
  for (let r = 0; r < count; r++) {
    let norm = 0;
    for (let c = 0; c < dim; c++) {
      const v = int8[r * dim + c] * inv;
      mat[r * dim + c] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let c = 0; c < dim; c++) mat[r * dim + c] /= norm;
  }
  return { mat, dim, count };
}

// ---------------------------------------------------------------------------
// Model load (lazy, cached)
// ---------------------------------------------------------------------------
export async function ensureEmbedder(modelId = 'Xenova/all-MiniLM-L6-v2') {
  if (_pipelinePromise) return _pipelinePromise;
  setStatus('loading');
  _pipelinePromise = (async () => {
    const { pipeline, env } = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
    // Allow remote model download; cache in the browser for repeat visits.
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const extractor = await pipeline('feature-extraction', modelId, {
      quantized: true,
    });
    setStatus('ready');
    return extractor;
  })().catch(err => {
    console.warn('[embedder] load failed — falling back to keyword search:', err);
    setStatus('failed');
    _pipelinePromise = null; // allow a later retry
    throw err;
  });
  return _pipelinePromise;
}

// Returns a normalized Float32Array(dim) or null on failure.
export async function embedQuery(text) {
  try {
    const extractor = await ensureEmbedder();
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return Float32Array.from(out.data);
  } catch {
    return null;
  }
}
