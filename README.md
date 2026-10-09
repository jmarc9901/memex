# Memex Offline

Tu propio buscador personal, **100% offline**, que indexa lo que tienes en el
disco y te permite buscar por palabras exactas. Sin nube, sin telemetría, sin
GPU, sin LLM y **sin dependencias** (solo Node.js).

Esta es la **Ruta 1 / Fase 1** del roadmap: motor de búsqueda full-text con
SQLite FTS5. Es la base sobre la que se añadirán OCR, embeddings, transcripción
y respuestas con RAG.

## Requisitos

- **Node.js >= 22.5** (usa el módulo integrado `node:sqlite` con FTS5).
  Verificado con Node v26.

## Uso

```bash
# Indexar una carpeta (incremental: solo reprocesa lo que cambió)
node bin/memex.js index ~/Documentos

# Buscar por palabras (ranking BM25, fragmentos resaltados)
node bin/memex.js search "ansiedad"
node bin/memex.js search '"proyecto x" 2024'      # frase exacta
node bin/memex.js search "informe*"                # prefijo
node bin/memex.js search "ansiedad embeddings" --any   # OR en vez de AND
node bin/memex.js search "conclusiones" --json         # salida JSON

# Estadísticas del índice y vaciado
node bin/memex.js stats
node bin/memex.js clear
```

Opciones comunes:

| Opción | Descripción |
| --- | --- |
| `--db RUTA` | Base de datos del índice (por defecto `./.memex/index.db`, o `$MEMEX_DB`) |
| `--force` | Reindexa todo ignorando la caché por fecha/tamaño |
| `-n`, `--limit` | Número máximo de resultados (por defecto 20) |
| `--any` | Une los términos con OR |
| `--json` | Salida en JSON (para scripts) |

## Qué indexa

- **Texto y notas:** `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.log`, `.csv`,
  `.tsv`, `.json`, `.yaml`, `.toml`, `.ini`, `.html`, `.xml`, `.tex`, `.srt`, `.vtt`.
- **Código:** `.js/.ts/.py/.rb/.go/.rs/.java/.c/.cpp/.cs/.sh/.sql/.css/...`.
- **PDF:** si tienes `pdftotext` (poppler) o `mutool` (mupdf) instalados, se
  extrae su texto automáticamente. Si no, los PDFs se omiten sin fallar.
- Se ignoran archivos binarios, carpetas como `.git`, `node_modules`, `dist`,
  `build`, `__pycache__`, `.venv`, etc.

## Cómo funciona

1. `walkFiles` recorre la carpeta y filtra por extensión y reglas de ignorado.
2. `extractText` lee cada archivo (descarta binarios y archivos enormes) y
   `chunkText` lo trocea en fragmentos de ~1600 caracteres respetando párrafos.
3. Cada fragmento va a una tabla `chunks` y a la tabla virtual FTS5 `chunks_fts`
   (tokenizer `unicode61 remove_diacritics 2`, así *cancion* encuentra *Canción*).
4. `search` usa `bm25()` para el ranking y `snippet()` para los extractos.
5. El indexado es **incremental**: si el tamaño y la fecha no cambian, no se
   reprocesa el archivo.

## Tests

```bash
npm test        # node --test
```

## Roadmap (pendiente)

- Fase 2: búsqueda semántica con embeddings en CPU.
- Fase 3: OCR (Tesseract) para imágenes y PDFs escaneados.
- Fase 4: transcripción de audio/vídeo (Whisper.cpp).
- Fase 5-7: CLI unificado, capa RAG opcional y GUI de escritorio.

Licencia MIT.
