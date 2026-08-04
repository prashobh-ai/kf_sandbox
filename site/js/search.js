// =============================================================================
// BM25 client — queries the precomputed index in-memory.
// =============================================================================

const TOKEN_RE = /[A-Za-z0-9]+/g;

export function tokenize(text) {
  const out = [];
  const matches = text.toLowerCase().matchAll(TOKEN_RE);
  for (const m of matches) {
    if (m[0].length > 1) out.push(m[0]);
  }
  return out;
}

// =============================================================================
// Ranker
// =============================================================================
export class BM25 {
  constructor(bm25Index) {
    this.termId = bm25Index.term_id;
    this.idf = bm25Index.idf;
    this.docLen = bm25Index.doc_len;
    this.avgdl = bm25Index.avgdl;
    this.postings = bm25Index.postings;
    this.k1 = bm25Index.k1;
    this.b = bm25Index.b;
    this.N = bm25Index.doc_len.length;
  }

  search(query, topK = 6) {
    const terms = tokenize(query);
    if (terms.length === 0 || this.N === 0) return [];

    const scores = new Float32Array(this.N);
    const seen = new Set();

    for (const term of terms) {
      const tid = this.termId[term];
      if (tid === undefined) continue;
      const idf = this.idf[tid];
      const posting = this.postings[tid] || [];
      for (const [chunkIdx, tf] of posting) {
        const dl = this.docLen[chunkIdx];
        const norm = 1 - this.b + this.b * (dl / this.avgdl);
        const score = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * norm);
        scores[chunkIdx] += score;
        seen.add(chunkIdx);
      }
    }

    const ranked = [];
    for (const idx of seen) {
      if (scores[idx] > 0) ranked.push({ chunkIdx: idx, score: scores[idx] });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, topK);
  }
}
