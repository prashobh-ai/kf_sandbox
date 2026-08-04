// ============================================================================
// Knowledge Fabric · Command Center — main entry
// ============================================================================

import { BM25 } from './search.js';
import { buildAnswer } from './answer.js';
import { KnowledgeGraph } from './graph.js';
import { initInsights } from './insights.js';
import { initLineage, renderLineage } from './lineage.js';
import { initExplain, openExplain } from './explain.js';
import { HybridRetriever } from './retrieval.js';
import { ensureEmbedder, onEmbedderStatus } from './embedder.js';
import {
  webgpuAvailable, ensureEngine, synthesize, onLlmStatus, MODEL_ID,
} from './llm.js';

const INDEX_URL = 'data/index.json';

// ============================================================================
// Global state
// ============================================================================
const state = {
  index: null,
  bm25: null,
  retriever: null,
  graph: null,
  chunks: [],
  chunksById: new Map(),
  entitiesById: new Map(),
  lastQuery: null,
  lastResult: null,
  useLLM: false,       // AI synthesis enabled by the user
  semanticReady: false,
};

// ============================================================================
// Boot
// ============================================================================
async function boot() {
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`Failed to load index: ${res.status}`);
    state.index = await res.json();
  } catch (err) {
    showFatalError(err.message);
    return;
  }

  state.chunks = state.index.chunks;
  state.chunksById = new Map(state.chunks.map(c => [c.id, c]));
  state.chunkIdxById = new Map(state.chunks.map((c, i) => [c.id, i]));
  state.entitiesById = new Map(state.index.entities.map(e => [e.id, e]));
  state.bm25 = new BM25(state.index.bm25);
  state.retriever = new HybridRetriever(state.index, state.bm25);
  state.demo = await loadDemoAnswers();

  renderCommandTiles();
  setupGalaxy();
  setupCopilot();
  setupSuggestions();
  setupEngineControls();

  initLineage({ onChunkClick: id => showChunkDetail(state.chunksById.get(id)) });
  initExplain(state.index);
  initInsights(state.index, { onEntityClick: showEntityDetail });
}

// ============================================================================
// Engine controls — semantic warm-up + optional in-browser LLM synthesis
// ============================================================================
function setupEngineControls() {
  const sub = document.getElementById('copilot-sub');
  const pill = document.getElementById('ai-pill');
  const btn = document.getElementById('ai-enable');
  const label = document.getElementById('ai-enable-label');

  // Warm the (small) semantic model in the background so hybrid search is
  // ready by the first question. Falls back to keyword search on failure.
  if (state.retriever.hasSemantic) {
    onEmbedderStatus(s => {
      if (s === 'loading') sub.textContent = 'Loading semantic search model…';
      else if (s === 'ready') {
        state.semanticReady = true;
        sub.textContent = 'Semantic search across all Nova Biomedical meter manuals';
      } else if (s === 'failed') {
        sub.textContent = 'Keyword search across the Nova Biomedical meter manuals';
      }
    });
    ensureEmbedder().catch(() => {});
  } else {
    sub.textContent = 'Keyword search across the Nova Biomedical meter manuals';
  }

  // In-browser LLM synthesis (opt-in — it's a ~0.9 GB one-time download).
  if (!webgpuAvailable()) {
    btn.disabled = true;
    label.textContent = 'AI synthesis needs WebGPU';
    btn.title = 'This browser has no WebGPU support. Semantic search still works; ' +
      'for local AI synthesis use a recent Chrome or Edge.';
    return;
  }

  onLlmStatus(({ status, progress }) => {
    if (status === 'loading') {
      pill.hidden = false;
      pill.textContent = `Loading AI model… ${progress}%`;
      pill.className = 'ai-pill loading';
      label.textContent = 'Loading…';
      btn.disabled = true;
    } else if (status === 'ready') {
      pill.hidden = false;
      pill.textContent = 'AI synthesis ON';
      pill.className = 'ai-pill on';
      btn.hidden = true;
      state.useLLM = true;
    } else if (status === 'failed') {
      pill.hidden = false;
      pill.textContent = 'AI model failed to load';
      pill.className = 'ai-pill err';
      btn.disabled = false;
      label.textContent = 'Retry AI synthesis';
    }
  });

  btn.addEventListener('click', () => {
    ensureEngine().catch(() => {});
  });
}

function showFatalError(message) {
  document.getElementById('messages').innerHTML = `
    <div class="copilot-empty">
      <p style="color:var(--danger);font-weight:500">Couldn't load the knowledge index.</p>
      <p style="margin-top:6px;color:var(--text-mute);font-size:12px">${escapeHtml(message)}</p>
      <p style="margin-top:8px;color:var(--text-mute);font-size:11px">Build the index first: <code>python -m pipeline.build_index</code></p>
    </div>`;
}

// ============================================================================
// Command Center tiles
// ============================================================================
function renderCommandTiles() {
  const s = state.index.stats;
  setTile('documents', s.document_count);
  setTile('entities', s.entity_count);
  setTile('relationships', s.relationship_count);
  setTile('chunks', s.chunk_count);
  setTile('domains', estimateDomains());
}

function setTile(key, value) {
  const el = document.getElementById(`tile-${key}`);
  if (!el) return;
  animateNumber(el, value);
}

function animateNumber(el, target) {
  const duration = 700;
  const start = performance.now();
  function step(t) {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatNumber(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// Heuristic: domains = clusters of high-mention entities + top-level document themes
function estimateDomains() {
  const docTopSections = new Set();
  for (const c of state.chunks) {
    if (c.section_path?.length) docTopSections.add(c.section_path[0]);
  }
  return Math.max(state.index.documents.length, docTopSections.size);
}

// ============================================================================
// Knowledge Galaxy (graph)
// ============================================================================
function setupGalaxy() {
  const container = document.getElementById('galaxy');
  state.graph = new KnowledgeGraph(container, state.index);
  state.graph.render();
  state.graph.onEntityClick = showEntityDetail;

  document.getElementById('galaxy-detail-close').addEventListener('click', () => {
    document.getElementById('galaxy-detail').hidden = true;
  });

  document.getElementById('galaxy-status').textContent =
    `${state.index.stats.entity_count} entities · ${state.index.stats.relationship_count} relationships · ask a question to traverse`;
}

// ============================================================================
// AI Copilot — chat
// ============================================================================
function setupCopilot() {
  const form = document.getElementById('composer-form');
  const input = document.getElementById('composer-input');
  const submit = document.getElementById('composer-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    submit.disabled = true;
    await ask(q);
    submit.disabled = false;
    input.focus();
  });
}

function setupSuggestions() {
  document.querySelectorAll('#suggestions .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('composer-input').value = btn.textContent.trim();
      document.getElementById('composer-form').dispatchEvent(new Event('submit'));
    });
  });
}

// ============================================================================
// Curated instant-answer cache — pre-authored, grounded answers for the key
// demo questions. Rendered instantly (no model load, no typing delay).
// ============================================================================
async function loadDemoAnswers() {
  try {
    const res = await fetch('data/demo_answers.json');
    if (!res.ok) return null;
    const data = await res.json();
    const entries = (data.answers || []).map(a => {
      const keys = [a.q, ...(a.aliases || [])].map(normalizeQ);
      return { ...a, keys, tokenSets: keys.map(k => new Set(k.split(' ').filter(Boolean))) };
    });
    return { entries };
  } catch {
    return null;
  }
}

function normalizeQ(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchDemo(question) {
  if (!state.demo) return null;
  const nq = normalizeQ(question);
  if (nq.split(' ').filter(Boolean).length < 2) return null;
  const qTokens = new Set(nq.split(' ').filter(Boolean));

  // 1) Exact, then phrase containment (a distinctive key phrase appears in the
  //    question or vice-versa) — catches natural short forms reliably.
  for (const e of state.demo.entries) {
    if (e.keys.includes(nq)) return e;
    for (const key of e.keys) {
      if (key.split(' ').length >= 3 && nq.length >= 8 &&
          (nq.includes(key) || key.includes(nq))) {
        return e;
      }
    }
  }

  // 2) Fuzzy token-overlap fallback.
  let best = null, bestScore = 0;
  for (const e of state.demo.entries) {
    for (const ts of e.tokenSets) {
      let inter = 0;
      for (const t of qTokens) if (ts.has(t)) inter++;
      const union = new Set([...qTokens, ...ts]).size;
      const j = union ? inter / union : 0;
      if (j > bestScore) { bestScore = j; best = e; }
    }
  }
  return bestScore >= 0.66 ? best : null;
}

function citationsFromChunkIds(chunkIds) {
  const cites = [];
  chunkIds.forEach((cid, i) => {
    const chunk = state.chunksById.get(cid);
    if (!chunk) return;
    cites.push({
      num: cites.length + 1,
      chunkIdx: state.chunkIdxById.get(cid),
      chunk,
      score: 1 - i * 0.04,
      confidence: Math.max(0.6, 1 - i * 0.05),
    });
  });
  return cites;
}

function askFromCache(question, entry) {
  const citations = citationsFromChunkIds(entry.chunk_ids);
  const validIds = citations.map(c => c.chunk.id);
  const trace = state.graph.highlightTrace(validIds);
  const answerHtml = renderLlmAnswer(entry.answer, citations.length);
  const ranked = citations.map(c => ({ chunkIdx: c.chunkIdx, score: c.score }));

  const { root, textEl } = createAssistantBubble();
  textEl.classList.add('reveal');
  finalizeAssistant(root, { question, answerHtml, citations, ranked, trace });

  state.lastQuery = question;
  state.lastResult = { ranked, citations, answerHtml, trace };
  renderLineage(question, answerHtml, citations);
  updateCopilotMetrics(citations, trace, ranked);
  updateGalaxyStatus(trace);
}

// ============================================================================
// Ask flow — orchestrates all four panes
// ============================================================================
async function ask(question) {
  clearCopilotEmpty();
  appendUserMessage(question);

  // 1) Curated instant answers for the key demo questions — no wait, no model.
  const cached = matchDemo(question);
  if (cached) { askFromCache(question, cached); return; }

  // Hybrid semantic + keyword retrieval (falls back to BM25 on any failure).
  let ranked;
  try {
    ranked = await state.retriever.search(question, 6);
  } catch (err) {
    console.warn('[ask] retrieval failed, using BM25:', err);
    ranked = state.bm25.search(question, 6);
  }

  const trace = state.graph.highlightTrace(ranked.map(r => state.chunks[r.chunkIdx].id));

  if (state.useLLM) {
    await askWithLLM(question, ranked, trace);
  } else {
    const { answerHtml, citations } = buildAnswer(question, ranked, state.chunks);
    const { root } = createAssistantBubble();
    finalizeAssistant(root, { question, answerHtml, citations, ranked, trace });
    state.lastQuery = question;
    state.lastResult = { ranked, citations, answerHtml, trace };
    renderLineage(question, answerHtml, citations);
    updateCopilotMetrics(citations, trace, ranked);
    updateGalaxyStatus(trace);
  }
}

// Turn retrieved chunks into a numbered citation/passage set for the LLM.
function toPassages(ranked) {
  const top = ranked[0]?.score || 1;
  return ranked.map((r, i) => ({
    num: i + 1,
    chunkIdx: r.chunkIdx,
    chunk: state.chunks[r.chunkIdx],
    score: r.score,
    confidence: top > 0 ? Math.max(0.15, r.score / top) : 0,
  }));
}

async function askWithLLM(question, ranked, trace) {
  const passages = toPassages(ranked);
  const { root, textEl } = createAssistantBubble();
  textEl.classList.add('streaming');
  textEl.textContent = 'Synthesizing an answer from the manuals…';

  let acc = '';
  try {
    const text = await synthesize(question, passages, {
      onToken: delta => {
        acc += delta;
        textEl.textContent = acc;
        scrollMessages();
      },
    });
    const answerHtml = renderLlmAnswer(text || acc, passages.length);
    textEl.classList.remove('streaming');
    finalizeAssistant(root, { question, answerHtml, citations: passages, ranked, trace });
    state.lastQuery = question;
    state.lastResult = { ranked, citations: passages, answerHtml, trace };
    renderLineage(question, answerHtml, passages);
    updateCopilotMetrics(passages, trace, ranked);
    updateGalaxyStatus(trace);
  } catch (err) {
    console.warn('[ask] LLM synthesis failed, using extractive answer:', err);
    textEl.classList.remove('streaming');
    const { answerHtml, citations } = buildAnswer(question, ranked, state.chunks);
    finalizeAssistant(root, { question, answerHtml, citations, ranked, trace });
    renderLineage(question, answerHtml, citations);
    updateCopilotMetrics(citations, trace, ranked);
    updateGalaxyStatus(trace);
  }
}

// Render a model answer: escape, keep **bold**, turn [n] into clickable
// citation refs, and preserve simple paragraph/line structure.
function renderLlmAnswer(text, maxN) {
  let html = escapeHtml(text.trim());
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[(\d+)\]/g, (m, d) => {
    const n = parseInt(d, 10);
    return n >= 1 && n <= maxN
      ? `<sup class="cite-ref" data-cite="${n}">[${n}]</sup>`
      : m;
  });
  html = html
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function updateCopilotMetrics(citations, trace, ranked) {
  const metricsEl = document.getElementById('copilot-metrics');
  metricsEl.hidden = false;
  const topConf = citations[0]?.confidence ? Math.round(citations[0].confidence * 100) : 0;
  document.getElementById('m-conf').textContent = `${topConf}%`;
  document.getElementById('m-sources').textContent = citations.length;
  document.getElementById('m-rels').textContent = trace.edgeCount;
  document.getElementById('m-paths').textContent = Math.max(1, trace.edgeCount);
}

function updateGalaxyStatus(trace) {
  const el = document.getElementById('galaxy-status');
  const panel = document.getElementById('galaxy-activation');
  const chipsEl = document.getElementById('ga-chips');
  const metaEl = document.getElementById('ga-meta');

  if (trace.activeEntities.length === 0) {
    el.textContent = 'No entities activated — try a more specific question.';
    if (panel) panel.hidden = true;
    return;
  }
  el.textContent = `${trace.activeEntities.length} activated · ${trace.neighborCount} neighbors · ${trace.edgeCount} relationships traversed`;

  // On-galaxy caption: name exactly which entities the answer activated.
  if (panel && chipsEl && metaEl) {
    const top = [...trace.activeEntities]
      .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0))
      .slice(0, 10);
    chipsEl.innerHTML = top
      .map(e => `<button class="ga-chip" data-eid="${e.id}">${escapeHtml(e.name)}</button>`)
      .join('');
    const more = trace.activeEntities.length - top.length;
    metaEl.textContent =
      `${trace.activeEntities.length} concept${trace.activeEntities.length === 1 ? '' : 's'} activated` +
      (more > 0 ? ` (+${more} more)` : '') +
      ` · ${trace.edgeCount} relationship${trace.edgeCount === 1 ? '' : 's'} traversed`;
    chipsEl.querySelectorAll('.ga-chip').forEach(btn => {
      btn.addEventListener('click', () => showEntityDetail(parseInt(btn.dataset.eid, 10)));
    });
    panel.hidden = false;
  }
}

// ============================================================================
// Message rendering
// ============================================================================
function clearCopilotEmpty() {
  const empty = document.querySelector('.copilot-empty');
  if (empty) empty.remove();
}

function appendUserMessage(text) {
  const tpl = document.getElementById('tpl-user-msg').content.cloneNode(true);
  tpl.querySelector('.msg-bubble').textContent = text;
  document.getElementById('messages').appendChild(tpl);
  scrollMessages();
}

// Create an (initially empty) assistant bubble and return handles so callers
// can stream tokens into it, then finalize with citations + actions.
function createAssistantBubble() {
  const frag = document.getElementById('tpl-assistant-msg').content.cloneNode(true);
  const root = frag.querySelector('.msg-assistant');
  const textEl = root.querySelector('.answer-text');
  document.getElementById('messages').appendChild(frag); // moves `root` into the DOM
  scrollMessages();
  return { root, textEl };
}

function finalizeAssistant(root, { question, answerHtml, citations, ranked, trace }) {
  root.querySelector('.answer-text').innerHTML = answerHtml;

  // Confidence bar
  const topConf = citations[0]?.confidence ?? 0;
  const pct = Math.round(topConf * 100);
  root.querySelector('.ac-fill').style.width = `${pct}%`;
  root.querySelector('.ac-value').textContent = `${pct}%`;

  const explainPayload = () => ({
    question, ranked, citations,
    traceEntities: trace.activeEntities,
    traceEdges: trace.edgeCount,
    answerHtml,
  });

  root.querySelector('.action-explain').addEventListener('click', () => openExplain(explainPayload()));

  // Inline [#N] citation refs → chunk detail in galaxy detail card
  root.querySelectorAll('.cite-ref').forEach(ref => {
    ref.addEventListener('click', () => {
      const n = parseInt(ref.dataset.cite, 10);
      const cite = citations.find(c => c.num === n);
      if (cite) showChunkDetail(cite.chunk);
    });
  });
  scrollMessages();

  // Also expose the global "Explain Answer" button in the lineage pane header
  const explainBtn = document.getElementById('explain-btn');
  explainBtn.hidden = false;
  explainBtn.onclick = () => openExplain(explainPayload());
}

function scrollMessages() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

// ============================================================================
// Galaxy detail card — entity and chunk views
// ============================================================================
function showChunkDetail(chunk) {
  if (!chunk) return;
  const sectionPath = chunk.section_path?.length ? chunk.section_path.join(' › ') : '—';
  const entities = (chunk.entities || []).map(id => state.entitiesById.get(id)).filter(Boolean);

  const html = `
    <div class="entity-card-eyebrow">Retrieved Knowledge Unit</div>
    <div class="entity-card-title">${escapeHtml(stripExt(chunk.document_name))}</div>
    <div class="entity-card-meta">
      <div class="kv"><span class="k">Page</span><span class="v">${chunk.page}</span></div>
      <div class="kv"><span class="k">Paragraphs</span><span class="v">¶${chunk.paragraph_indices.join(', ¶')}</span></div>
      <div class="kv" style="flex:1;min-width:140px"><span class="k">Section Path</span><span class="v" style="font-size:11.5px;font-family:var(--font-sans);font-style:italic;color:var(--text-dim)">${escapeHtml(sectionPath)}</span></div>
    </div>
    <div class="entity-card-section">
      <h4>Full passage</h4>
      <div class="evidence" style="cursor:default">
        <div class="evidence-text" style="-webkit-line-clamp:unset;color:var(--text)">${escapeHtml(chunk.text)}</div>
      </div>
    </div>
    ${entities.length ? `
    <div class="entity-card-section">
      <h4>Entities in this passage</h4>
      <div class="entity-card-pills">
        ${entities.map(e => `<button class="pill pill-accent" data-eid="${e.id}">${escapeHtml(e.name)}</button>`).join('')}
      </div>
    </div>` : ''}`;

  openGalaxyDetail(html);
  bindDetailLinks();
}

function showEntityDetail(entityId) {
  const e = state.entitiesById.get(entityId);
  if (!e) return;
  state.graph.focusEntity(entityId);

  const chunks = e.chunk_ids
    .map(id => state.chunksById.get(id))
    .filter(Boolean)
    .slice(0, 4);

  const docs = new Set(chunks.map(c => c.document_name));

  const related = [];
  for (const r of state.index.relationships) {
    if (r.source === entityId) related.push({ id: r.target, weight: r.weight });
    else if (r.target === entityId) related.push({ id: r.source, weight: r.weight });
  }
  related.sort((a, b) => b.weight - a.weight);
  const relatedTop = related.slice(0, 8).map(r => state.entitiesById.get(r.id)).filter(Boolean);

  // Premium entity card: Purpose (most-cited excerpt) · Dependencies (related entities)
  // · Appears In (documents) · Evidence (chunks)
  const purposeChunk = chunks[0];
  const purpose = purposeChunk?.paragraph_excerpt || purposeChunk?.text?.slice(0, 200) || '';

  const html = `
    <div class="entity-card-eyebrow">Entity · ${escapeHtml(e.kind)}</div>
    <div class="entity-card-title">${escapeHtml(e.name)}</div>
    <div class="entity-card-meta">
      <div class="kv"><span class="k">Mentions</span><span class="v">${e.mention_count}</span></div>
      <div class="kv"><span class="k">Documents</span><span class="v">${docs.size}</span></div>
      <div class="kv"><span class="k">Knowledge Units</span><span class="v">${e.chunk_ids.length}</span></div>
      <div class="kv"><span class="k">Connections</span><span class="v">${related.length}</span></div>
    </div>

    ${purpose ? `
    <div class="entity-card-section">
      <h4>Purpose</h4>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.55">${escapeHtml(purpose)}</p>
    </div>` : ''}

    ${relatedTop.length ? `
    <div class="entity-card-section">
      <h4>Dependencies & related concepts</h4>
      <div class="entity-card-pills">
        ${relatedTop.map(r => `<button class="pill" data-eid="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
      </div>
    </div>` : ''}

    ${docs.size ? `
    <div class="entity-card-section">
      <h4>Appears in</h4>
      <div class="entity-card-pills">
        ${[...docs].map(d => `<span class="pill pill-accent" style="cursor:default">${escapeHtml(stripExt(d))}</span>`).join('')}
      </div>
    </div>` : ''}

    <div class="entity-card-section">
      <h4>Evidence</h4>
      ${chunks.map(c => {
        const section = c.section_path?.length ? c.section_path.join(' › ') : '';
        return `
          <div class="evidence" data-cid="${c.id}">
            <div class="evidence-meta">
              <span class="doc">${escapeHtml(stripExt(c.document_name))}</span>
              <span class="sep">·</span>
              <span>page ${c.page}</span>
              ${section ? `<span class="sep">·</span><span style="font-style:italic">${escapeHtml(section)}</span>` : ''}
            </div>
            <div class="evidence-text">${escapeHtml(c.text)}</div>
          </div>`;
      }).join('')}
    </div>`;

  openGalaxyDetail(html);
  bindDetailLinks();
}

function bindDetailLinks() {
  document.querySelectorAll('#galaxy-detail [data-eid]').forEach(el => {
    el.addEventListener('click', () => showEntityDetail(parseInt(el.dataset.eid, 10)));
  });
  document.querySelectorAll('#galaxy-detail [data-cid]').forEach(el => {
    el.addEventListener('click', () => showChunkDetail(state.chunksById.get(parseInt(el.dataset.cid, 10))));
  });
}

function openGalaxyDetail(html) {
  document.getElementById('galaxy-detail-body').innerHTML = html;
  document.getElementById('galaxy-detail').hidden = false;
}

// ============================================================================
// Util
// ============================================================================
function stripExt(name) {
  return name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================================
// Bootstrap (wait for vis-network)
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof vis === 'undefined') {
    const check = setInterval(() => {
      if (typeof vis !== 'undefined') {
        clearInterval(check);
        boot();
      }
    }, 50);
  } else {
    boot();
  }
});
