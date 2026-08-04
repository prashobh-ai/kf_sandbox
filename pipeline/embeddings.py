"""Build-time semantic embeddings.

Computes a dense vector for every chunk so the browser can do *semantic*
retrieval (meaning, not just keywords) at query time. Vectors are int8-quantized
to keep index.json small and shipped inside it.

Model: sentence-transformers/all-MiniLM-L6-v2 (384-dim, mean-pooled, L2-normalized).
The browser side (transformers.js) uses the matching `Xenova/all-MiniLM-L6-v2`
weights, so the two embedding spaces line up.

This module is intentionally best-effort: if the embedding backend can't be
imported or the model can't be fetched (e.g. offline CI), the caller falls back
to a keyword-only index and the site degrades to BM25 retrieval.
"""
from __future__ import annotations

import base64
from typing import Optional

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BROWSER_MODEL = "Xenova/all-MiniLM-L6-v2"
DIM = 384


def _embed_with_fastembed(texts: list[str]) -> Optional[list[list[float]]]:
    try:
        from fastembed import TextEmbedding
    except Exception as exc:  # pragma: no cover - env dependent
        print(f"  ! fastembed unavailable ({exc})")
        return None
    try:
        model = TextEmbedding(model_name=MODEL_NAME)
        # fastembed yields L2-normalized float32 vectors
        return [list(map(float, v)) for v in model.embed(texts)]
    except Exception as exc:  # pragma: no cover - env dependent
        print(f"  ! fastembed embedding failed ({exc})")
        return None


def _embed_with_sentence_transformers(texts: list[str]) -> Optional[list[list[float]]]:
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:  # pragma: no cover - env dependent
        print(f"  ! sentence-transformers unavailable ({exc})")
        return None
    try:
        model = SentenceTransformer(MODEL_NAME)
        vecs = model.encode(
            texts, normalize_embeddings=True, show_progress_bar=False
        )
        return [list(map(float, v)) for v in vecs]
    except Exception as exc:  # pragma: no cover - env dependent
        print(f"  ! sentence-transformers embedding failed ({exc})")
        return None


def _quantize_int8(vectors: list[list[float]]) -> str:
    """Pack normalized vectors (values in [-1, 1]) as int8 and base64-encode.

    Dequantize in the browser with v / 127.
    """
    out = bytearray()
    for vec in vectors:
        for x in vec:
            q = round(max(-1.0, min(1.0, x)) * 127)
            out.append(q & 0xFF)  # store as unsigned byte; JS reads as int8
    return base64.b64encode(bytes(out)).decode("ascii")


def build_embeddings(chunks: list) -> Optional[dict]:
    """Return an embeddings block for index.json, or None if unavailable.

    Each chunk is embedded from its section path + text so headings add context.
    """
    if not chunks:
        return None

    texts = []
    for c in chunks:
        section = " ".join(getattr(c, "section_path", []) or [])
        body = getattr(c, "text", "") or ""
        texts.append((section + " \n " + body).strip()[:2000])

    print(f"[*] Embedding {len(texts)} chunks with {MODEL_NAME} ...")
    vectors = _embed_with_fastembed(texts)
    if vectors is None:
        vectors = _embed_with_sentence_transformers(texts)
    if vectors is None:
        print("  ! No embedding backend available — shipping keyword-only index")
        return None

    if len(vectors) != len(texts) or len(vectors[0]) != DIM:
        print(
            f"  ! Unexpected embedding shape ({len(vectors)}x"
            f"{len(vectors[0]) if vectors else 0}) — skipping"
        )
        return None

    print(f"  ✓ {len(vectors)} vectors ({DIM}-dim, int8-quantized)")
    return {
        "model": MODEL_NAME,
        "browser_model": BROWSER_MODEL,
        "dim": DIM,
        "count": len(vectors),
        "scale": 127,
        "quant": "int8",
        # chunk order matches index["chunks"], flat int8 matrix, base64
        "data": _quantize_int8(vectors),
    }
