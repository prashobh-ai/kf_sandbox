// ============================================================================
// In-browser answer synthesis — WebLLM (MLC).
//
// Runs a small instruct model entirely on the user's GPU via WebGPU. No API
// keys, no backend, no data leaves the browser. The model is downloaded once
// (~0.9 GB) from a CDN and cached. Strictly grounded: it may only use the
// retrieved passages and must cite them as [n]. If WebGPU or the model is
// unavailable, callers fall back to the extractive answer builder.
// ============================================================================

const WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm';
// q4f32 variant avoids requiring shader-f16 GPU support → widest compatibility.
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

let _enginePromise = null;
let _status = 'idle'; // idle | loading | ready | unsupported | failed
let _progress = 0;
const _listeners = new Set();

export function webgpuAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export function llmStatus() {
  return { status: _status, progress: _progress };
}
export function onLlmStatus(fn) {
  _listeners.add(fn);
  fn(llmStatus());
  return () => _listeners.delete(fn);
}
function emit() {
  for (const fn of _listeners) fn(llmStatus());
}
function setStatus(s, p) {
  _status = s;
  if (typeof p === 'number') _progress = p;
  emit();
}

// ---------------------------------------------------------------------------
// Engine load (lazy, cached). Call to begin the one-time model download.
// ---------------------------------------------------------------------------
export async function ensureEngine() {
  if (!webgpuAvailable()) {
    setStatus('unsupported');
    throw new Error('WebGPU not available in this browser');
  }
  if (_enginePromise) return _enginePromise;
  setStatus('loading', 0);
  _enginePromise = (async () => {
    const webllm = await import(/* @vite-ignore */ WEBLLM_CDN);
    const engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: report => {
        // report.progress is 0..1
        setStatus('loading', Math.round((report.progress || 0) * 100));
      },
    });
    setStatus('ready', 100);
    return engine;
  })().catch(err => {
    console.warn('[llm] engine load failed:', err);
    setStatus('failed');
    _enginePromise = null;
    throw err;
  });
  return _enginePromise;
}

// ---------------------------------------------------------------------------
// Grounded prompt
// ---------------------------------------------------------------------------
function buildMessages(question, passages) {
  const context = passages
    .map((p, i) => {
      const doc = p.chunk.document_name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const sec = (p.chunk.section_path || []).join(' › ');
      return `[${i + 1}] (${doc}, page ${p.chunk.page}${sec ? ', ' + sec : ''})\n${p.chunk.text}`;
    })
    .join('\n\n');

  const system =
    'You are the Nova Biomedical documentation assistant. You answer questions ' +
    'about Nova Biomedical point-of-care meters (glucose, lactate, creatinine) ' +
    'using ONLY the numbered context passages provided. Rules:\n' +
    '- Base every claim strictly on the passages. Never invent facts, values, or steps.\n' +
    '- Cite the passages you use inline as [1], [2], etc., matching the passage numbers.\n' +
    '- If the passages do not contain the answer, say so plainly and suggest what to search instead.\n' +
    '- When a question spans multiple meters or documents, synthesize across passages and be explicit about which meter each detail applies to.\n' +
    '- Write a COMPLETE, well-structured answer. Do not over-summarize: include all relevant details, numeric values, thresholds, and steps found in the passages. Use a short lead sentence followed by clear bullet points or numbered steps, grouped by meter/topic where helpful.\n' +
    '- Be clinical and precise, but thorough. Do not copy passage text verbatim — rewrite it into a coherent answer.';

  const user =
    `Context passages:\n\n${context}\n\n` +
    `Question: ${question}\n\n` +
    `Answer using only the passages above, with inline [n] citations.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Streams the answer. onToken(deltaText) is called as tokens arrive.
// Returns the full answer text.
export async function synthesize(question, passages, { onToken } = {}) {
  const engine = await ensureEngine();
  const messages = buildMessages(question, passages);
  const stream = await engine.chat.completions.create({
    messages,
    temperature: 0.2,
    max_tokens: 900,
    stream: true,
  });
  let full = '';
  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content || '';
    if (delta) {
      full += delta;
      if (onToken) onToken(delta);
    }
  }
  return full.trim();
}

export { MODEL_ID };
