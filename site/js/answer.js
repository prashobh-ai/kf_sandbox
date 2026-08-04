// =============================================================================
// Answer composer — builds extractive answers with inline citation references.
// Phase 1: no LLM. Every sentence in the answer ties back to a retrieved chunk.
// =============================================================================

import { tokenize } from './search.js';

const MAX_SENTENCES_PER_CHUNK = 3;
const MAX_TOTAL_SENTENCES = 10;

// =============================================================================
// Sentence splitting & scoring
// =============================================================================
function splitSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [];
}

function scoreSentence(sentence, queryTerms) {
  const tokens = new Set(tokenize(sentence));
  let hits = 0;
  for (const t of queryTerms) if (tokens.has(t)) hits++;
  // Length-normalized overlap, slight preference for medium-length sentences
  const lenPenalty = Math.min(1, tokens.size / 20) * Math.min(1, 40 / Math.max(tokens.size, 1));
  return hits * (0.6 + 0.4 * lenPenalty);
}

// =============================================================================
// Build answer + citation map
// =============================================================================
export function buildAnswer(query, ranked, chunks) {
  if (ranked.length === 0) {
    return {
      answerHtml: "I couldn't find anything in the indexed corpus that matches that question. Try rephrasing, or check the suggested questions above.",
      citations: [],
    };
  }

  const queryTerms = tokenize(query);
  const citations = [];
  const pieces = [];
  let usedSentences = 0;

  for (let i = 0; i < ranked.length; i++) {
    if (usedSentences >= MAX_TOTAL_SENTENCES) break;
    const { chunkIdx, score } = ranked[i];
    const chunk = chunks[chunkIdx];
    const sentences = splitSentences(chunk.text);

    const scored = sentences
      .map(s => ({ s: s.trim(), score: scoreSentence(s, queryTerms) }))
      .filter(x => x.s.length > 20 && x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SENTENCES_PER_CHUNK);

    // Fallback if query terms didn't match any sentence: use the first sentence
    const chosen = scored.length ? scored : [{ s: sentences[0]?.trim() || chunk.paragraph_excerpt, score: 0 }];
    if (!chosen[0].s) continue;

    const citationNum = citations.length + 1;
    citations.push({
      num: citationNum,
      chunkIdx,
      chunk,
      score,
    });

    for (const { s } of chosen) {
      if (usedSentences >= MAX_TOTAL_SENTENCES) break;
      pieces.push(`${s}<sup class="cite-ref" data-cite="${citationNum}">[${citationNum}]</sup>`);
      usedSentences++;
    }
  }

  const answerHtml = pieces.join(' ');

  // Normalize confidence: top score → 1.0
  const maxScore = Math.max(...citations.map(c => c.score), 0.001);
  for (const c of citations) {
    c.confidence = c.score / maxScore;
  }

  return { answerHtml, citations };
}
