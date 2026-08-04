# Nova Biomedical · Knowledge Fabric
> A static, GitHub-Pages-hosted knowledge chatbot for **Nova Biomedical point-of-care meter documentation**. Every answer is grounded in **document → page → section → paragraph** citations, sourced directly from the official Instructions for Use and Reference Manuals. The knowledge graph shows **how each answer was derived**.

**No backend. No vector database. No API keys. No Docker.**
Open the GitHub Pages URL — it works.

### Indexed corpus

This demo is built from five official Nova Biomedical manuals ([novabiomedicaldocs.com/ifu-meters](https://novabiomedicaldocs.com/ifu-meters/)):

| Device | Document |
|--------|----------|
| **Lactate Plus Xpress 2** | Instructions for Use Manual (LPN 62659) |
| **StatSensor Creatinine Meter** | Instructions for Use Manual (LPN 43177) |
| **StatSensor Creatinine Meter** | Reference Manual (LPN 43317) |
| **StatStrip Lactate Hospital Meter** | Instructions for Use Manual (LPN 47632) |
| **StatStrip Lactate Hospital Meter** | Reference Manual (LPN 47643) |

Ask about intended use, quality control, cleaning and disinfecting, error codes, eGFR estimation, linearity testing, or specifications — every answer cites the exact page and passage.

[![CI](https://github.com/PrashobhPaul/novabiomedicaldocs_demo/actions/workflows/ci.yml/badge.svg)](https://github.com/PrashobhPaul/novabiomedicaldocs_demo/actions/workflows/ci.yml)
[![Deploy](https://github.com/PrashobhPaul/novabiomedicaldocs_demo/actions/workflows/deploy.yml/badge.svg)](https://github.com/PrashobhPaul/novabiomedicaldocs_demo/actions/workflows/deploy.yml)

---

## What it demonstrates

The Phase 1 build is a **Knowledge Fabric Command Center**, not "a chatbot with citations." That positioning is intentional, and is reflected in the UI from the first 30 seconds:

1. **Command Center landing.** The page opens on a five-tile counter bar (Documents · Entities · Relationships · Knowledge Units · Domains) and an animated, drifting **Knowledge Galaxy**. The chat box is one of four panels — not the centerpiece.

2. **Four-pane mission-control layout.**
   - **Knowledge Galaxy** — force-directed graph that lights up the activated entities and traversed relationships for every answer.
   - **AI Copilot** — citation-grounded chat with live confidence / sources / relationships / paths metrics.
   - **Source Lineage** — vertical tree showing Answer → Document → Page → Section → Paragraph for every claim.
   - **Insights Dashboard** — Heatmap (knowledge density by domain), interactive Word Cloud, and Timeline of corpus growth.

3. **"Why did AI say this?"** — a full-screen reasoning overlay shows the five-step pipeline: Question → Retrieved Documents (with BM25 scores) → Graph Traversal → Final Context → Answer. Every step is inspectable.

4. **Premium entity cards.** Clicking any node in the Galaxy slides up a card with Purpose, Dependencies, Appears In, and Evidence — the way an architect actually explores a knowledge surface.

5. **Zero-friction deployment.** Static site. No backend, no vector DB, no LLM, no API keys. Fork → enable Pages → done.

---

## Architecture

```
                           ╭─────────────────────────╮
                           │   docs_source/  *.md    │
                           │            *.pdf        │
                           │            *.docx       │
                           ╰────────────┬────────────╯
                                        │ GitHub Actions runs
                                        │ python -m pipeline.build_index
                                        ▼
       ┌────────────────────────────────────────────────────────────────┐
       │  pipeline/   (build-time, ~5s on a small corpus)               │
       │   parsers.py       heading-aware parsing                       │
       │   chunker.py       section-respecting chunks (~700 chars)      │
       │   entities.py      regex extraction + co-occurrence            │
       │   bm25_index.py    precomputed inverted index + IDF            │
       │   build_index.py   emits site/data/index.json                  │
       └─────────────────────────┬──────────────────────────────────────┘
                                 │  ~80 KB JSON
                                 ▼
       ┌────────────────────────────────────────────────────────────────┐
       │  site/   →  served by GitHub Pages                             │
       │                                                                │
       │   ┌──────────────────────────────────────────────────────────┐ │
       │   │  COMMAND CENTER  ·  docs · entities · rels · units · dom │ │
       │   ├──────────────────────────┬───────────────────────────────┤ │
       │   │   KNOWLEDGE GALAXY       │   AI COPILOT                  │ │
       │   │   (vis-network)          │   (semantic + BM25 + local AI)│ │
       │   ├──────────────────────────┼───────────────────────────────┤ │
       │   │   SOURCE LINEAGE         │   INSIGHTS DASHBOARD          │ │
       │   │   Answer → Doc → Page    │   Heatmap · Cloud · Timeline  │ │
       │   │          → Paragraph     │                               │ │
       │   └──────────────────────────┴───────────────────────────────┘ │
       │                                                                │
       │   + "Why did AI say this?" overlay                             │
       │     Question → Retrieved → Traversal → Context → Answer        │
       └────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                  Browser loads index.json once.
                  All retrieval, graph rendering, lineage,
                  and insights compute in-memory in-browser.
```

---

## Deploy to GitHub Pages

### From scratch (5 minutes)

```bash
# 1. Fork or create the repo, then clone
git clone https://github.com/PrashobhPaul/novabiomedicaldocs_demo.git
cd YOUR_REPO

# 2. Drop your documents into docs_source/
cp ~/my-docs/*.md docs_source/

# 3. Commit and push
git add . && git commit -m "Initial corpus"
git push
```

### Enable Pages

1. Repo → **Settings** → **Pages**
2. Under **Source**, choose **GitHub Actions**

That's it. The next push triggers `.github/workflows/deploy.yml`, which rebuilds the index and publishes the site.

### From a phone (web UI only)

1. Fork this repo on github.com
2. Settings → Pages → Source = **GitHub Actions**
3. Edit / upload documents directly under `docs_source/` via the web editor
4. Each commit triggers a rebuild and deploy

No local toolchain required.

---

## Local dev (optional)

```bash
./scripts/dev.sh
```

Builds the index and serves the site at http://localhost:8000.

Run tests:

```bash
pip install -r pipeline/requirements.txt pytest
pytest tests/ -v
```

---

## Adding your own documents

Drop files into `docs_source/`. Supported formats:

| Format | Extension | Heading detection |
|--------|-----------|-------------------|
| Markdown | `.md` | H1–H4 tags (best citation quality) |
| Plain text | `.txt` | Heuristic (ALL CAPS / Title Case lines) |
| PDF | `.pdf` | Heuristic + native page numbers |
| Word | `.docx` | Native Heading 1–4 style names |

The build pipeline runs automatically on every push. Citation quality is best for Markdown and DOCX because the heading hierarchy is explicit; for PDFs the pipeline does its best with a layout heuristic.

---

## Custom domain (optional)

To serve at `kf.your-company.com` instead of `username.github.io/repo`:

1. Add a file `site/CNAME` containing `kf.your-company.com`
2. In your DNS, create a CNAME record pointing `kf` to `YOUR_USERNAME.github.io`
3. Repo → Settings → Pages → Custom domain → enter `kf.your-company.com`

---

## What's in / what's out

### In

- Markdown, plain text, PDF, DOCX ingestion with heading awareness
- Section-respecting chunker with paragraph-level provenance
- **Hybrid retrieval** — semantic embeddings (all-MiniLM-L6-v2, computed at build time) fused with client-side BM25 keyword scoring. Semantic captures meaning ("newborn" → neonate, "sugar" → glucose); BM25 nails exact tokens, abbreviations, and part numbers.
- **In-browser AI synthesis (optional)** — a small instruct model (Llama-3.2-1B via WebLLM/WebGPU) runs entirely in the user's browser to write grounded, cited answers that synthesize across multiple documents. No API keys, no backend, no data leaves the device. Click **Enable AI synthesis** to load it (~0.9 GB, downloaded once and cached).
- Graceful degradation: semantic search works everywhere (WASM, no GPU); if the AI model or WebGPU isn't available, answers fall back to extractive composition, and if the embedding model can't load, retrieval falls back to BM25. The page never breaks.
- Citation card UI showing document, page, section path, paragraph excerpt, and a confidence score
- Knowledge graph with force-directed layout (vis-network)
- Reasoning trace: per-query subgraph highlight showing which entities were activated and which relationships were traversed
- GitHub Actions: tests + automatic Pages deployment

### Out (deferred)

- Hosted backend, authentication, per-document permissions
- Live Confluence / Jira connectors (mock data only)

---

## Repository layout

```
.
├── README.md
├── docs_source/                    your documents go here
│   ├── Lactate Plus Xpress 2 - Instructions for Use.pdf
│   ├── StatSensor Creatinine Meter - Instructions for Use.pdf
│   ├── StatSensor Creatinine Meter - Reference Manual.pdf
│   ├── StatStrip Lactate Hospital Meter - Instructions for Use.pdf
│   └── StatStrip Lactate Hospital Meter - Reference Manual.pdf
├── pipeline/                       build-time Python
│   ├── parsers.py
│   ├── chunker.py
│   ├── entities.py
│   ├── bm25_index.py
│   └── build_index.py
├── site/                           what GitHub Pages serves
│   ├── index.html
│   ├── styles/main.css
│   ├── js/
│   │   ├── main.js
│   │   ├── search.js
│   │   ├── answer.js
│   │   └── graph.js
│   └── data/index.json             generated by CI on every push
├── tests/test_pipeline.py
├── scripts/dev.sh                  local build + serve
└── .github/workflows/
    ├── ci.yml                      tests
    └── deploy.yml                  build + publish Pages
```

---

## Demo script for client calls

The first 30 seconds decide whether the room sees a chatbot or a platform. Open on the **Knowledge Galaxy**, not chat.

**Minute 1 — The "wow" landing.**
Open the live URL. Point at the **Command Center tiles**: Documents · Entities · Relationships · Knowledge Units · Domains. The animated graph drifts behind. *"This is not a chatbot. This is mission control for every Nova Biomedical meter manual."*

**Minute 2 — Ask Knowledge Fabric.**
Click the suggested chip **"How do I run a quality control test?"** Three things happen at once: the AI Copilot returns a grounded answer with `[N]` citation refs, the Galaxy lights up the activated entities (QC, control solution, linearity) in green and their neighbors in blue, and the Source Lineage panel populates with the **Document → Page → Section → Paragraph** tree pointing straight into the Instructions for Use manual. Confidence, sources, relationships, and graph paths metrics flash in the header.

**Minute 3 — Click "Explain Answer."**
The full-screen reasoning overlay opens, showing the five-step pipeline: Question → Retrieved Documents (with BM25 scores) → Graph Traversal (activated entities) → Final Context (cited passages) → Answer. *"Every clinical instruction our AI surfaces is traceable back to the exact page of the official manual."*

**Minute 4 — Click an entity in the Galaxy.**
Click **StatSensor Creatinine Meter** or **Linearity**. The premium entity card slides up: Purpose, Dependencies (related concepts), Appears In (documents), Evidence (cited chunks). *"This is how a clinician or field engineer explores the documentation when investigating a procedure."*

**Minute 5 — Insights Dashboard.**
Switch the Insights panel through **Heatmap → Word Cloud → Timeline**. Heatmap shows knowledge density per document so you can see which manual carries the most coverage. Cloud highlights the most-cited concepts — click any word to refocus the Galaxy. Timeline shows the corpus growing as manuals are added.

Close with: *"This is a Knowledge Fabric for Nova Biomedical's device documentation. The chatbot is just one window into it."*

---

## License

MIT
