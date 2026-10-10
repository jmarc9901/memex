# Memex Offline

Tu propio buscador personal, **100% offline**, que indexa lo que tienes en el
disco: texto, notas, código, PDFs, imágenes (OCR), audio y vídeo. Busca por
palabras exactas y por significado, responde preguntas con citas a tus archivos
y crea *trails* (caminos asociativos) entre documentos.

**Sin nube, sin telemetría, sin GPU y sin dependencias** (solo Node.js). La capa
de IA generativa es **opcional**: el proyecto funciona por completo sin ella.

## Requisitos

- **Node.js >= 22.5** (usa el módulo integrado `node:sqlite` con FTS5).
  Verificado con Node v26.
- Opcional, para funciones extra (si no están, se omiten sin fallar):
  - `pdftotext` (poppler) o `mutool` (mupdf) → texto de PDFs.
  - `tesseract` → OCR de imágenes.
  - `whisper-cli` / `whisper` (+ `ffmpeg`) → transcripción de audio/vídeo.

## Instalación

```bash
git clone https://github.com/jmarc9901/memex.git
cd memex
node bin/memex.js --help
```

No hay dependencias que instalar. Opcionalmente, `npm link` para tener el
comando `memex` disponible en el `PATH`.

## Uso rápido

```bash
# 1. Indexar una carpeta (incremental: solo reprocesa lo que cambió)
node bin/memex.js index ~/Documentos

# 2. Buscar por palabras (ranking BM25, fragmentos resaltados)
node bin/memex.js search "ansiedad"
node bin/memex.js search '"proyecto x" 2024'          # frase exacta
node bin/memex.js search "informe*"                    # prefijo
node bin/memex.js search "ansiedad embeddings" --any   # OR en vez de AND
node bin/memex.js search "como me sentia" --mode semantic

# 3. Preguntar en lenguaje natural (RAG opcional; sin config, muestra fuentes)
node bin/memex.js ask "¿qué conclusiones saqué del proyecto X?"

# 4. Servidor local + GUI web
node bin/memex.js serve        # http://127.0.0.1:4747
```

## Comandos

| Comando | Descripción |
| --- | --- |
| `index [carpeta]` | Indexa (o reindexa) una carpeta de forma incremental. Por defecto, la carpeta actual. |
| `search <consulta>` | Búsqueda híbrida (léxica + semántica) con ranking. Alias: `find`. |
| `ask <pregunta>` | RAG: recupera contexto local y, si hay proveedor configurado, genera una respuesta. |
| `export <consulta>` | Exporta resultados a `jsonl` (defecto), `csv` o `md`. |
| `relate <ref>` | Documentos más parecidos a una ruta o consulta (por vectores). |
| `trails` | Lista los trails existentes. |
| `trail create/add/link/show/rm` | Crea y edita trails asociativos. |
| `serve` | Arranca la API local y la GUI web. |
| `stats` | Estadísticas del índice (archivos, fragmentos, vectores, trails). |
| `clear` | Vacía el índice (documentos, chunks y trails). |

### Opciones comunes

| Opción | Descripción |
| --- | --- |
| `--db RUTA` | Base de datos del índice (por defecto `./.memex/index.db`, o `$MEMEX_DB`). |
| `--force` | Reindexa todo ignorando la caché por fecha/tamaño. |
| `--no-embed` | Indexa solo texto, sin calcular embeddings. |
| `--mode` | `hybrid` (defecto), `lexical` o `semantic`. |
| `-n`, `--limit` | Número máximo de resultados (por defecto 20). |
| `--any` | Une los términos con OR. |
| `--format` | Formato de `export`: `jsonl`, `csv` o `md`. |
| `-o`, `--out` | Archivo de salida de `export`. |
| `--host`, `--port` | Host y puerto de `serve`. |
| `--json` | Salida en JSON (para scripts). |

### Ejemplos

```bash
node bin/memex.js export "ansiedad" --format csv -o ansiedad.csv
node bin/memex.js trail create proyecto-x --desc "cómo llegué a las conclusiones"
node bin/memex.js trail add proyecto-x ~/notas/proyecto.md --note "borrador"
node bin/memex.js trail link proyecto-x ~/notas/proyecto.md ~/notas/revision.md
node bin/memex.js trail show proyecto-x --json   # grafo listo para D3
node bin/memex.js serve --port 8080
```

## Interfaz gráfica web

`memex serve` levanta un servidor que escucha **solo en localhost** y sirve una
GUI sin dependencias (HTML/CSS/JS vanilla) en `http://127.0.0.1:4747`:

- **Buscar**: pestañas de modo, resaltado de coincidencias, OR opcional.
- **Preguntar**: respuesta RAG con lista de fuentes citadas.
- **Trails**: listar, abrir y añadir nodos a trails.
- **Indexar**: lanzar el indexado de una carpeta y ver el resumen.

La GUI se apoya en la misma API que consume la extensión:

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/stats` | Estadísticas del índice. |
| `GET` | `/api/search?q=&mode=&any=&limit=` | Búsqueda. |
| `GET` | `/api/relate?ref=&limit=` | Documentos relacionados. |
| `GET` | `/api/trails` · `/api/trails/:name` | Listar / ver un trail (grafo D3). |
| `POST` | `/api/trails/:name` | Añadir nodo (`{ref,note}`) o enlace (`{from,to,label}`). |
| `POST` | `/api/save` | Guardar un documento (`{url,title,text}`). |
| `POST` | `/api/ask` | Pregunta RAG. |
| `POST` | `/api/index` | Indexar una carpeta (`{path}`). |
| `GET` | `/api/config` | Configuración activa. |

## Extensión de navegador (opcional)

En `extension/` hay una extensión Chromium (MV3) que guarda la página actual o
la selección en tu índice local vía `POST /api/save`. Solo habla con
`127.0.0.1`/`localhost`; no envía nada a internet. Instrucciones en
[extension/README.md](extension/README.md).

## Configuración

Precedencia: **variables de entorno > archivo de config > valores por defecto**.

El archivo de config se busca, por orden, en `$MEMEX_CONFIG`,
`./.memex/config.json` y `~/.memex/config.json`:

```json
{
  "embed_provider": "hash",
  "embed_dim": 256,
  "rag": {
    "enabled": false,
    "provider": "openai-compatible",
    "base_url": "",
    "api_key": "",
    "model": ""
  },
  "server": { "host": "127.0.0.1", "port": 4747 }
}
```

Variables de entorno: `MEMEX_DB`, `MEMEX_CONFIG`, `MEMEX_EMBED_PROVIDER`,
`MEMEX_EMBED_DIM`, `MEMEX_RAG_API_KEY`, `MEMEX_RAG_BASE_URL`,
`MEMEX_RAG_MODEL`, `MEMEX_RAG_PROVIDER`, `MEMEX_PORT`, `MEMEX_OCR_LANG`,
`MEMEX_WHISPER_MODEL`.

## Qué indexa

- **Texto y notas:** `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.log`, `.csv`,
  `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.ini`, `.html`, `.xml`,
  `.tex`, `.srt`, `.vtt`.
- **Código:** `.js/.ts/.tsx/.py/.rb/.go/.rs/.java/.c/.cpp/.cs/.sh/.sql/.css/...`.
- **PDF:** con `pdftotext` o `mutool` si están instalados; si no, se omiten.
- **Imágenes:** OCR con `tesseract` si está instalado.
- **Audio/vídeo:** transcripción con `whisper.cpp` o `whisper` de Python.
- **Web:** páginas guardadas desde la extensión (`source: "extension"`).

Se ignoran archivos binarios, carpetas como `.git`, `node_modules`, `dist`,
`build`, `__pycache__`, `.venv`, etc., y archivos de más de 25 MB.

## Cómo funciona

1. `walkFiles` recorre la carpeta y filtra por extensión y reglas de ignorado.
2. `extractText` lee cada archivo (descarta binarios y archivos enormes) y
   `chunkText` lo trocea en fragmentos de ~1600 caracteres respetando párrafos.
3. Cada fragmento va a la tabla `chunks` y a la tabla virtual FTS5 `chunks_fts`
   (tokenizer `unicode61 remove_diacritics 2`: *cancion* encuentra *Canción*).
4. Los embeddings (feature hashing en CPU, 256 dims, sin dependencias) se
   guardan como BLOB en `chunks.embedding`.
5. `hybridSearch` combina el ranking BM25 con la similitud coseno y fusiona
   ambas listas con **Reciprocal Rank Fusion**.
6. `ask` recupera los fragmentos más relevantes y construye un prompt con citas.
7. El indexado es **incremental**: si el tamaño y la fecha no cambian, no se
   reprocesa el archivo. `--force` ignora la caché.

### Arquitectura

```
bin/memex.js      entrada CLI
src/cli.js        parsing de argumentos y comandos
src/config.js     config (archivo + entorno)
src/db.js         SQLite + FTS5, esquema, consultas, trails
src/indexer.js    indexado incremental y guardado de documentos web
src/extract.js    recorrido, extracción y chunking
src/query.js      construcción de consultas FTS5
src/embeddings.js embeddings en CPU (hash) y utilidades de vectores
src/search.js     búsqueda híbrida + fusión RRF
src/rag.js        recuperación + generación opcional
src/trails.js     trails asociativos y relación entre documentos
src/ocr.js        OCR opcional (tesseract)
src/media.js      transcripción opcional (whisper)
src/tools.js      detección de binarios externos
src/server.js     API local + GUI web
web/              GUI (HTML/CSS/JS vanilla)
extension/        extensión de navegador (MV3)
```

## Tests

```bash
npm test        # node --test
```

Cubren parseo de consultas, chunking, indexado incremental, búsqueda léxica y
semántica, fusión RRF, embeddings, trails, RAG offline y los endpoints HTTP.

## Benchmarks

En un equipo modesto, el objetivo es indexar y buscar sin GPU y con un consumo
de RAM bajo. El propio CLI reporta tiempos:

```bash
node bin/memex.js index ~/Documentos --json   # campo "seconds"
node bin/memex.js search "ansiedad" --json    # campo "took_ms"
node bin/memex.js stats                        # tamaño del índice
```

## Roadmap

La visión completa (fases, rutas de IA y proveedores gratuitos) está en
[docs/ROADMAP.md](docs/ROADMAP.md). Estado actual: **fases 1-8 implementadas**.

## Licencia

MIT. Ver [LICENSE](LICENSE).
