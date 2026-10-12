# Memex Offline

[![CI](https://github.com/jmarc9901/memex/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jmarc9901/memex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 22.13](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](package.json)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

Your own personal search engine, **100% offline**, that indexes what you already
have on disk: text, notes, code, PDFs, images (OCR), audio and video. Search by
exact words (BM25) or by fuzzy text similarity, ask questions with citations to
your files, and build *trails* (associative paths) between documents.

**No cloud, no telemetry, no GPU, no dependencies** (only Node.js). The
generative-AI layer is **optional**: the project works completely without it.

> Español: [README.md](README.md)

## Requirements

- **Node.js >= 22.13** (uses the built-in `node:sqlite` with FTS5). Verified on
  Node v26. Before 22.13 (and 23.4 on the 23 line) `node:sqlite` required the
  `--experimental-sqlite` flag, which is why the minimum is not 22.5:
  `bin/memex.js` checks the version and fails with a clear message instead of an
  obscure import error.
- Optional, for extra features (skipped gracefully if missing):
  - `pdftotext` (poppler) or `mutool` (mupdf) → PDF text.
  - `tesseract` → image OCR.
  - `whisper-cli` / `whisper` (+ `ffmpeg`) → audio/video transcription.
  - `onnxruntime-node` + a local model → real neural semantic search.

## Install

```bash
git clone https://github.com/jmarc9901/memex.git
cd memex
node bin/memex.js --help
```

No dependencies to install. Optionally `npm link` for a global `memex` command.

## Quick start (one command)

```bash
# Sets up embeddings, config and index in a single step (all local)
node bin/memex.js init ~/Documents

# Then:
node bin/memex.js search "anxiety"
node bin/memex.js ask "what conclusions did I reach on project X?"
node bin/memex.js serve          # http://127.0.0.1:4747
```

`memex init` downloads a small local ONNX model (~23 MB, all-MiniLM-L6-v2) into
`~/.memex/models` to enable **real** semantic search. If there is no network or
the download fails, it warns and falls back to the lexical `hash` provider — it
never leaves the project broken. Use `--no-model` to stay on `hash`, or
`--model /path/to/model.onnx` to use a model you already have.

## Commands

| Command | Description |
| --- | --- |
| `init [folder]` | One-shot setup: model, config and first index. |
| `index [folder]` | Index (or reindex) a folder incrementally. |
| `search <query>` | Hybrid search (lexical + semantic) with ranking. Alias: `find`. |
| `ask <question>` | RAG: retrieves local context and generates an answer if a provider is set. |
| `embed [folder]` | Computes pending embeddings (neural with `onnx`). `--force` recomputes all. |
| `export <query>` | Exports results to `jsonl` (default), `csv` or `md`. |
| `relate <ref>` | Documents most similar to a path or query (by vectors). |
| `trails` / `trail ...` | List, create, edit, `suggest` and export associative trails. |
| `serve` | Starts the local API and web GUI. |
| `mcp` | Starts a local MCP server (stdio) for AI agents. |
| `config show\|set\|path` | View or edit the effective config. |
| `doctor` / `models` | Diagnostics of external tools, config and local LLM servers. |
| `bench` / `stats` / `clear` | Benchmark, index stats, wipe the index. |

Common options: `--db RUTA`, `--force`, `--no-embed`, `--mode hybrid|lexical|semantic`,
`-n/--limit`, `--any`, `--json`, and `--allow-remote` (serve) to bind outside
localhost — refused by default because the API has no authentication.

## MCP server (for AI agents)

`memex mcp` exposes your local index as [MCP](https://modelcontextprotocol.io)
tools over stdio — **entirely on your machine**, no hosting needed. Claude
Desktop, Cursor, Continue or any MCP client can then search your files.

Tools exposed: `memex_search`, `memex_ask`, `memex_relate`, `memex_trails`,
`memex_trail_show`, `memex_stats`, `memex_index`.

Example client config:

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/absolute/path/to/memex/bin/memex.js", "mcp"]
    }
  }
}
```

## Web GUI

`memex serve` listens on **loopback only** by default and serves a dependency-free
GUI (vanilla HTML/CSS/JS): search, ask, trails (with an SVG graph and DOT/Markdown
export) and indexing. Same API the browser extension uses. Binding to another
interface (`--host 0.0.0.0`) is rejected unless you pass `--allow-remote`.

## Configuration

Precedence: **environment variables > config file > defaults**. The config file
is looked up at `$MEMEX_CONFIG`, `./.memex/config.json`, then `~/.memex/config.json`.

```json
{
  "embed_provider": "hash",
  "embed_dim": 256,
  "embed_model": "",
  "embed_tokenizer": "",
  "rag": { "enabled": false, "provider": "openai-compatible", "base_url": "", "api_key": "", "model": "" },
  "server": { "host": "127.0.0.1", "port": 4747 }
}
```

`rag.provider` accepts `openai-compatible`, `groq`, `openrouter`, `gemini`, and
the local presets `ollama`, `llamacpp`, `lmstudio` (no API key needed). Cloudflare
Workers AI is used via `base_url` (it embeds your `account_id`).

### Neural embeddings (optional)

```bash
node bin/memex.js config set embed_provider onnx
node bin/memex.js config set embed_dim 384
node bin/memex.js config set embed_model ~/.memex/models/all-MiniLM-L6-v2/model_quantized.onnx
node bin/memex.js embed --force
```

If `onnxruntime-node` or the model is missing, it warns and uses `hash`. Switching
providers requires recomputing vectors so dimensions match.

## What it indexes

Text and notes, code, PDFs (with poppler/mupdf), images (OCR), `.zip`/`.gz`
archives, audio/video (transcription) and saved web pages. Binary files, heavy
folders (`.git`, `node_modules`, `dist`, …) and files over 25 MB are skipped.

## How it works

1. `walkFiles` walks the folder and filters by extension and ignore rules.
2. `extractText` reads each file and `chunkText` splits it into ~1600-char chunks.
3. Each chunk goes into the `chunks` table and the FTS5 `chunks_fts` virtual
   table (`unicode61 remove_diacritics 2`: *cancion* finds *Canción*).
4. Embeddings are stored as BLOBs in `chunks.embedding`. Default is CPU *feature
   hashing* (lexical, tolerant of typos); `onnx` computes real neural vectors.
5. `hybridSearch` combines BM25 with cosine and fuses both lists via **Reciprocal
   Rank Fusion**.
6. `ask` retrieves the most relevant chunks and builds a prompt with citations.
7. Indexing is **incremental** (size + mtime); `--force` ignores the cache.
8. Semantic scoring uses an in-memory vector index: for large corpora a binary
   (sign-bit) prefilter with popcount shortlists candidates before exact cosine.

### Architecture

```
bin/memex.js      CLI entry point
src/cli.js        argument parsing and commands
src/init.js       one-shot onboarding (model + config + index)
src/config.js     config (file + environment)
src/db.js         SQLite + FTS5, schema, queries, trails
src/indexer.js    incremental indexing, web docs, batch embeddings
src/extract.js    walking, extraction and chunking
src/archive.js    ZIP/gzip reading without dependencies
src/query.js      FTS5 query builder
src/embeddings.js CPU embeddings (hash) and async embed helpers
src/onnx.js       optional neural embeddings (ONNX: tokenizer + pooling)
src/vectorstore.js in-memory vector index + binary prefilter
src/search.js     hybrid search + RRF fusion
src/rag.js        retrieval + optional generation
src/trails.js     associative trails and document relations
src/ocr.js        optional OCR (tesseract)
src/media.js      optional transcription (whisper)
src/doctor.js     external-tool and config diagnostics
src/bench.js      indexing and search benchmark
src/tools.js      external binary detection
src/server.js     local API + web GUI
src/mcp.js        local MCP server (stdio)
web/              GUI (vanilla HTML/CSS/JS)
extension/        browser extension (MV3)
```

## Tests

```bash
npm test        # node --test
npm run check   # dependency-free syntax check
```

## Limitations

- The default semantic search is **lexical** (feature hashing), not neural. For
  real semantics enable the optional `onnx` provider.
- Linear-style semantic scoring with an in-memory index; great for personal
  corpora (tens/hundreds of thousands of chunks), not for millions.
- PDF/OCR/transcription require external binaries; without them those parts are
  skipped.

## Privacy & security

- The server listens on **loopback only**; a non-loopback `--host` is refused at
  startup unless `--allow-remote` is explicit. The API rejects any `Origin` that
  is not `localhost`/`127.0.0.1` or a browser extension.
- GUI responses carry `Content-Security-Policy` (no external resources, no inline
  scripts), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`; static file serving is confined to `web/`.
- No cloud, no telemetry. The only network traffic is to the RAG provider you
  configure (optional) and, once, to download the model in `memex init`.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, what to run before a PR and the zero-dependency rule.
- [SECURITY.md](SECURITY.md) — threat model and private vulnerability reporting.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version.
- [docs/ROADMAP.md](docs/ROADMAP.md) — vision, phases and AI routes.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — code of conduct.

## License

MIT. See [LICENSE](LICENSE).
