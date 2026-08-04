"""Pipeline tests — verify parser, chunker, entity extraction, and BM25 build."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.bm25_index import build_bm25_index
from pipeline.chunker import chunk_paragraphs, tokenize
from pipeline.entities import build_relationships, extract_entities_from_chunks
from pipeline.parsers import parse_markdown, parse_text


# =============================================================================
# Fixtures
# =============================================================================
@pytest.fixture
def md_doc(tmp_path):
    p = tmp_path / "sample.md"
    p.write_text("""# Top Heading

## Subsection One

The Knowledge Fabric ingests documents and builds a graph. BM25 retrieves passages with citations.

## Subsection Two

The Knowledge Fabric grounds every answer in a document, page, section, and paragraph. BM25 ranking is the retrieval engine.

### Deeper Section

Citations from the Knowledge Fabric include the document name and page number. BM25 scores drive the ranking.
""")
    return p


@pytest.fixture
def docs_source_dir():
    return Path(__file__).resolve().parent.parent / "docs_source"


# =============================================================================
# Parser tests
# =============================================================================
def test_markdown_parser_extracts_headings(md_doc):
    parsed = parse_markdown(md_doc)
    assert len(parsed.paragraphs) >= 3
    sections = [p.section_path for p in parsed.paragraphs]
    assert any("Subsection One" in path for path in sections)
    assert any("Subsection Two" in path for path in sections)
    assert any("Deeper Section" in path for path in sections)


def test_text_parser_handles_caps_headings(tmp_path):
    p = tmp_path / "sample.txt"
    p.write_text("INTRODUCTION\n\nThis is the body of the introduction.\n\nDETAILS\n\nThis is the body of the details section.")
    parsed = parse_text(p)
    assert len(parsed.paragraphs) == 2
    assert parsed.paragraphs[0].section_path == ["INTRODUCTION"]
    assert parsed.paragraphs[1].section_path == ["DETAILS"]


# =============================================================================
# Chunker tests
# =============================================================================
def test_chunker_preserves_breadcrumbs(md_doc):
    parsed = parse_markdown(md_doc)
    chunks = chunk_paragraphs(parsed.paragraphs, document_id=0, document_name=md_doc.name)
    assert chunks
    for c in chunks:
        assert c.document_name == md_doc.name
        assert c.text
        assert c.tokens
        assert isinstance(c.section_path, list)


def test_tokenize_lowercases_and_filters():
    tokens = tokenize("Knowledge Fabric uses BM25.")
    assert "knowledge" in tokens
    assert "fabric" in tokens
    assert "bm25" in tokens
    assert "." not in tokens


# =============================================================================
# Entity extraction tests
# =============================================================================
def test_entity_extraction_picks_up_proper_nouns(md_doc):
    parsed = parse_markdown(md_doc)
    chunks = chunk_paragraphs(parsed.paragraphs, document_id=0, document_name=md_doc.name)
    entities, mentions = extract_entities_from_chunks(chunks)
    names = {e["canonical"] for e in entities}
    # Either "Knowledge Fabric" as a phrase, or BM25 as an acronym
    assert any(n in names for n in {"knowledge fabric", "bm25"})


# =============================================================================
# Relationships
# =============================================================================
def test_relationships_built_from_real_corpus(docs_source_dir):
    from pipeline.parsers import iter_sources, parse_any

    sources = list(iter_sources(docs_source_dir))
    assert sources, "no source documents found"

    all_chunks = []
    next_id = 0
    for did, src in enumerate(sources):
        parsed = parse_any(src)
        cs = chunk_paragraphs(parsed.paragraphs, document_id=did, document_name=parsed.name, start_chunk_id=next_id)
        next_id += len(cs)
        all_chunks.extend(cs)

    entities, mentions = extract_entities_from_chunks(all_chunks)
    rels = build_relationships(entities, mentions)
    assert len(entities) >= 5
    assert len(rels) >= 1
    for r in rels:
        assert r["weight"] >= 2
        assert r["evidence_chunks"]


# =============================================================================
# BM25 index
# =============================================================================
def test_bm25_index_shape(md_doc):
    parsed = parse_markdown(md_doc)
    chunks = chunk_paragraphs(parsed.paragraphs, document_id=0, document_name=md_doc.name)
    idx = build_bm25_index(chunks)
    assert idx["vocab"]
    assert len(idx["idf"]) == len(idx["vocab"])
    assert len(idx["doc_len"]) == len(chunks)
    assert idx["avgdl"] > 0
    assert idx["k1"] == 1.5
    assert idx["b"] == 0.75


# =============================================================================
# End-to-end: build full index from docs_source
# =============================================================================
def test_full_pipeline_emits_valid_index(tmp_path, docs_source_dir):
    from pipeline.build_index import build

    out = tmp_path / "index.json"
    index = build(docs_source_dir, out)

    assert out.exists()
    loaded = json.loads(out.read_text())
    assert loaded["version"] == "1.0"
    assert loaded["stats"]["document_count"] >= 1
    assert loaded["stats"]["chunk_count"] >= 1
    assert loaded["stats"]["entity_count"] >= 1
    assert loaded["bm25"]["vocab"]
    # Verify a chunk has all citation fields
    chunk = loaded["chunks"][0]
    for field in ("id", "document_name", "page", "section_path", "paragraph_indices", "text", "paragraph_excerpt", "entities"):
        assert field in chunk, f"chunk missing field: {field}"
