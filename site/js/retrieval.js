// ============================================================================
// Hybrid retrieval — fuses semantic (embedding) similarity with BM25 keyword
// scores. Semantic captures meaning ("newborn" → neonate); BM25 captures exact
// tokens/abbreviations ("HI", "E-4", part numbers). Together they beat either
// one alone. Degrades gracefully to BM25-only when embeddings aren't available.
// ============================================================================

import { embedQuery, decodeChunkMatrix } from './embedder.js';

const SEM_WEIGHT = 0.62;
const BM25_WEIGHT = 0.38;

export class HybridRetriever {
  constructor(index, bm25) {
    this.index = index;
    this.bm25 = bm25;
    this.chunkCount = index.chunks.length;
    this.matrix = decodeChunkMatrix(index.embeddings); // {mat,dim,count} | null
  }

  get hasSemantic() {
    return !!this.matrix;
  }

  _semanticScores(qvec) {
    const { mat, dim, count } = this.matrix;
    const scores = new Float32Array(count);
    for (let r = 0; r < count; r++) {
      let dot = 0;
      const base = r * dim;
      for (let c = 0; c < dim; c++) dot += mat[base + c] * qvec[c];
      scores[r] = dot;
    }
    return scores;
  }

  // Returns [{ chunkIdx, score, semantic, keyword }] sorted desc.
  async search(query, topK = 6) {
    // Keyword side (request a wide pool so fusion has candidates).
    const bmList = this.bm25.search(query, 60);
    const bm = new Map(bmList.map(r => [r.chunkIdx, r.score]));
    const bmMax = bmList.length ? bmList[0].score : 0;

    // Semantic side (best-effort).
    let sem = null;
    let semMax = 0;
    if (this.matrix) {
      const qvec = await embedQuery(query);
      if (qvec && qvec.length === this.matrix.dim) {
        sem = this._semanticScores(qvec);
        for (let i = 0; i < sem.length; i++) if (sem[i] > semMax) semMax = sem[i];
      }
    }

    // If semantics unavailable, return pure BM25 (unchanged legacy behavior).
    if (!sem) {
      return bmList.slice(0, topK).map(r => ({
        chunkIdx: r.chunkIdx,
        score: r.score,
        semantic: 0,
        keyword: r.score,
      }));
    }

    // Fuse over the union of candidates.
    const candidates = new Set(bm.keys());
    // Add the strongest semantic hits even if BM25 missed them.
    const semOrder = Array.from(sem.keys()).sort((a, b) => sem[b] - sem[a]);
    for (let i = 0; i < Math.min(60, semOrder.length); i++) candidates.add(semOrder[i]);

    const fused = [];
    const invSem = semMax > 0 ? 1 / semMax : 0;
    const invBm = bmMax > 0 ? 1 / bmMax : 0;
    for (const idx of candidates) {
      const s = (sem[idx] || 0) * invSem;
      const k = (bm.get(idx) || 0) * invBm;
      fused.push({
        chunkIdx: idx,
        score: SEM_WEIGHT * s + BM25_WEIGHT * k,
        semantic: sem[idx] || 0,
        keyword: bm.get(idx) || 0,
      });
    }
    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, topK);
  }
}
