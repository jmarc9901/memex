# Memex Offline

[![CI](https://github.com/jmarc9901/memex/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jmarc9901/memex/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Node >= 22.13](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](package.json)
[![Dependencias: 0](https://img.shields.io/badge/dependencias-0-success.svg)](package.json)

> English: [README.en.md](README.en.md)

Tu propio buscador personal, **100% offline**, que indexa lo que tienes en el
disco: texto, notas, código, PDFs, imágenes (OCR), audio y vídeo. Busca por
palabras exactas (léxico, ranking BM25) y por coincidencia difusa de texto
(*embeddings* léxicos), responde preguntas con citas a tus archivos y crea
*trails* (caminos asociativos) entre documentos.

**Sin nube, sin telemetría, sin GPU y sin dependencias** (solo Node.js). La capa
de IA generativa es **opcional**: el proyecto funciona por completo sin ella.

## Requisitos

- **Node.js >= 22.13** (usa el módulo integrado `node:sqlite` con FTS5).
  Verificado con Node v26. Hasta 22.13 (y 23.4 en la línea 23) `node:sqlite`
  exigía el flag `--experimental-sqlite`, por eso el mínimo no es 22.5: `bin/memex.js`
  comprueba la versión y avisa con un mensaje claro en lugar de fallar al importar.
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
# 0. Onboarding en un comando: modelo + config + índice (todo local)
node bin/memex.js init ~/Documentos

# 1. Indexar una carpeta (incremental: solo reprocesa lo que cambió)
node bin/memex.js index ~/Documentos

# 2. Buscar por palabras (ranking BM25, fragmentos resaltados)
node bin/memex.js search "ansiedad"
node bin/memex.js search '"proyecto x" 2024'          # frase exacta
node bin/memex.js search "informe*"                    # prefijo
node bin/memex.js search "ansiedad embeddings" --any   # OR en vez de AND
node bin/memex.js search "como me sentia" --mode semantic  # similitud difusa (no neuronal)

# 3. Preguntar en lenguaje natural (RAG opcional; sin config, muestra fuentes)
node bin/memex.js ask "¿qué conclusiones saqué del proyecto X?"

# 4. Servidor local + GUI web
node bin/memex.js serve        # http://127.0.0.1:4747
```

## Comandos

| Comando | Descripción |
| --- | --- |
| `init [carpeta]` | Onboarding en un paso: prepara el modelo, escribe la config e indexa. |
| `index [carpeta]` | Indexa (o reindexa) una carpeta de forma incremental. Por defecto, la carpeta actual. |
| `search <consulta>` | Búsqueda híbrida (léxica + semántica) con ranking. Alias: `find`. |
| `ask <pregunta>` | RAG: recupera contexto local y, si hay proveedor configurado, genera una respuesta. |
| `export <consulta>` | Exporta resultados a `jsonl` (defecto), `csv` o `md`. |
| `relate <ref>` | Documentos más parecidos a una ruta o consulta (por vectores). |
| `trails` | Lista los trails existentes. |
| `trail create/add/link/show/rm` | Crea y edita trails asociativos. |
| `serve` | Arranca la API local y la GUI web. |
| `mcp` | Arranca un servidor MCP local (stdio) para agentes de IA. |
| `doctor` | Diagnóstico: herramientas externas, configuración efectiva y (`--ping`) servidores RAG locales. |
| `models` | Lista los modelos ofrecidos por los servidores LLM locales detectados. |
| `bench [carpeta]` | Benchmark reproducible de indexado y búsqueda sobre un índice desechable. |
| `stats` | Estadísticas del índice (archivos, fragmentos, vectores, trails). |
| `clear` | Vacía el índice (documentos, chunks y trails). |
| `embed [carpeta]` | Mantiene el texto al día y calcula los embeddings pendientes. Con el proveedor `onnx`, calcula los vectores neuronales. `--force` los recomputa todos. |
| `config show\|set\|path` | Muestra o edita la configuración efectiva (`config set rag.provider ollama`). |

### Opciones comunes

| Opción | Descripción |
| --- | --- |
| `--db RUTA` | Base de datos del índice (por defecto `./.memex/index.db`, o `$MEMEX_DB`). |
| `--force` | Reindexa todo ignorando la caché por fecha/tamaño. |
| `--no-embed` | Indexa solo texto, sin calcular embeddings. |
| `--mode` | `hybrid` (defecto), `lexical` o `semantic`. El modo `semantic` usa *embeddings* léxicos locales (coincidencia difusa), **no** semántica neuronal; ver [Limitaciones](#limitaciones). |
| `-n`, `--limit` | Número máximo de resultados (por defecto 20). |
| `--any` | Une los términos con OR. |
| `--format` | Formato de `export`: `jsonl`, `csv` o `md`. |
| `-o`, `--out` | Archivo de salida de `export`. |
| `--host`, `--port` | Host y puerto de `serve`. Cambiar `--host` fuera de loopback exige `--allow-remote`. |
| `--allow-remote` | (`serve`) Permite escuchar fuera de `localhost`. La API **no tiene autenticación**: úsalo solo en redes de confianza. |
| `--ping` | (`doctor`) Comprueba si los servidores RAG locales responden. |
| `--json` | Salida en JSON (para scripts). |

### Ejemplos

```bash
node bin/memex.js export "ansiedad" --format csv -o ansiedad.csv
node bin/memex.js trail create proyecto-x --desc "cómo llegué a las conclusiones"
node bin/memex.js trail add proyecto-x ~/notas/proyecto.md --note "borrador"
node bin/memex.js trail link proyecto-x ~/notas/proyecto.md ~/notas/revision.md
node bin/memex.js trail show proyecto-x --json      # grafo listo para D3
node bin/memex.js trail show proyecto-x --format mermaid  # diagrama Mermaid
node bin/memex.js trail show proyecto-x --format dot      # Graphviz DOT
node bin/memex.js trail show proyecto-x --format md       # Markdown
node bin/memex.js serve --port 8080
```

## Interfaz gráfica web

`memex serve` levanta un servidor que escucha **solo en loopback** por defecto y
sirve una GUI sin dependencias (HTML/CSS/JS vanilla) en `http://127.0.0.1:4747`.
Escuchar en otra interfaz (`--host 0.0.0.0`) se rechaza salvo que pases
`--allow-remote`, porque la API no tiene autenticación:

- **Buscar**: pestañas de modo, resaltado de coincidencias, OR opcional.
- **Preguntar**: respuesta RAG con lista de fuentes citadas.
- **Trails**: listar, abrir y añadir nodos; visualizar el grafo como SVG y descargarlo en DOT o Markdown (o copiar el diagrama Mermaid).
- **Indexar**: lanzar el indexado de una carpeta y ver el resumen.

La GUI se apoya en la misma API que consume la extensión:

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/stats` | Estadísticas del índice. |
| `GET` | `/api/search?q=&mode=&any=&limit=` | Búsqueda. |
| `GET` | `/api/relate?ref=&limit=` | Documentos relacionados. |
| `GET` | `/api/trails` · `/api/trails/:name?format=json\|dot\|mermaid\|md` | Listar / exportar un trail (D3 por defecto). |
| `POST` | `/api/trails/:name` | Añadir nodo (`{ref,note}`) o enlace (`{from,to,label}`). |
| `POST` | `/api/save` | Guardar un documento (`{url,title,text}`). |
| `POST` | `/api/ask` | Pregunta RAG. |
| `POST` | `/api/index` | Indexar una carpeta (`{path}`). |
| `POST` | `/api/embed` | Indexar y calcular los embeddings pendientes (`{path, force?}`). |
| `GET` | `/api/tools` | Herramientas opcionales disponibles y configuración. |
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
  "embed_model": "",
  "embed_tokenizer": "",
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

`rag.provider` acepta `openai-compatible`, `groq`, `openrouter`, `gemini`
(Google) y los presets locales `ollama` (`127.0.0.1:11434`), `llamacpp`
(`127.0.0.1:8080`) y `lmstudio` (`127.0.0.1:1234`). Los proveedores locales no
necesitan `api_key`. Cloudflare Workers AI se usa vía `base_url` (la URL incluye
el `account_id`), ya que es específica de cada cuenta.

### LLM local (Ruta 3)

`memex models` detecta servidores locales (Ollama, llama.cpp, LM Studio) y lista
sus modelos; `memex doctor --ping` comprueba si responden. Si no configuras
`rag.model`, `memex ask` usa el primer modelo que ofrezca el endpoint, así que
basta con tener un servidor local corriendo:

```bash
ollama serve              # en otra terminal
node bin/memex.js models   # -> ✓ ollama  llama3.2
node bin/memex.js ask "¿qué conclusiones saqué?"
```

Todo el flujo (recuperación y generación) ocurre en tu máquina.

Variables de entorno: `MEMEX_DB`, `MEMEX_CONFIG`, `MEMEX_MODELS_DIR`,
`MEMEX_EMBED_PROVIDER`, `MEMEX_EMBED_DIM`, `MEMEX_EMBED_MODEL`,
`MEMEX_EMBED_TOKENIZER`, `MEMEX_EMBED_MAX_LEN`, `MEMEX_RAG_API_KEY`,
`MEMEX_RAG_BASE_URL`, `MEMEX_RAG_MODEL`, `MEMEX_RAG_PROVIDER`, `MEMEX_PORT`,
`MEMEX_OCR_LANG`, `MEMEX_WHISPER_MODEL`.

## Servidor MCP (para agentes de IA)

`memex mcp` expone tu índice local como herramientas MCP por **stdio**, todo en
tu máquina (no hay que alojar nada). Claude Desktop, Cursor, Continue o cualquier
cliente MCP pueden buscar en tus archivos. Herramientas: `memex_search`,
`memex_ask`, `memex_relate`, `memex_trails`, `memex_trail_show`, `memex_stats`,
`memex_index`.

```json
{
  "mcpServers": {
    "memex": { "command": "node", "args": ["/ruta/a/memex/bin/memex.js", "mcp"] }
  }
}
```

### Embeddings neuronales (opcional, Ruta 1 ampliada)

Por defecto los *embeddings* son "hash" (léxicos). Para semántica **real**
(sinónimos, paráfrasis) puedes usar un modelo BERT local ejecutado con
`onnxruntime-node`. Es totalmente opcional y sigue siendo offline:

```bash
# 1. Instala el runtime (dependencia opcional, solo si quieres onnx)
npm install onnxruntime-node
# 2. Descarga all-MiniLM-L6-v2 en onnx + su vocab.txt (p. ej. desde HF)
# 3. Configúralo apuntando al modelo local
node bin/memex.js config set embed_provider onnx
node bin/memex.js config set embed_dim 384
node bin/memex.js config set embed_model /ruta/all-MiniLM-L6-v2.onnx
# 4. Indexa y calcula los vectores
node bin/memex.js index ~/Documentos
node bin/memex.js embed ~/Documentos
```

Si falta `onnxruntime-node` o el modelo, se avisa y se usa el proveedor
`hash` sin fallar. Al cambiar de proveedor hay que recalcular los vectores
(`embed --force`) para que las dimensiones coincidan.

## Qué indexa

- **Texto y notas:** `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.log`, `.csv`,
  `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.ini`, `.html`, `.xml`,
  `.tex`, `.srt`, `.vtt`.
- **Código:** `.js/.ts/.tsx/.py/.rb/.go/.rs/.java/.c/.cpp/.cs/.sh/.sql/.css/...`.
- **PDF:** con `pdftotext` o `mutool` si están instalados; si no, se omiten.
- **Imágenes:** OCR con `tesseract` si está instalado.
- **Comprimidos:** `.zip` (se indexan sus entradas de texto/código) y `.gz`
  de texto, sin dependencias. Se omiten entradas binarias, cifradas y de
  métodos no soportados.
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
4. Los embeddings se guardan como BLOB en `chunks.embedding`. Por defecto son
   *feature hashing* en CPU (256 dims, sin dependencias): **léxicos**, toleran
   erratas pero no sinónimos. Con `embed_provider: "onnx"` se calculan vectores
   neuronales reales con un modelo BERT local (`memex embed`).
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
src/archive.js    lectura de ZIP/gzip sin dependencias
src/query.js      construcción de consultas FTS5
src/embeddings.js embeddings en CPU (hash) y utilidades de vectores
src/onnx.js       embeddings neuronales opcionales (ONNX: tokenizer + pooling)
src/search.js     búsqueda híbrida + fusión RRF
src/rag.js        recuperación + generación opcional
src/trails.js     trails asociativos y relación entre documentos
src/ocr.js        OCR opcional (tesseract)
src/media.js      transcripción opcional (whisper)
src/doctor.js     diagnóstico de herramientas externas y configuración
src/bench.js      benchmark de indexado y búsqueda
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
node bin/memex.js bench ~/Documentos          # indexado + latencia de búsqueda
node bin/memex.js bench ~/Documentos --json    # mismas métricas en JSON
node bin/memex.js index ~/Documentos --json    # campo "seconds"
node bin/memex.js search "ansiedad" --json     # campo "took_ms"
node bin/memex.js stats                        # tamaño del índice
```

`memex bench` indexa en un índice temporal (no toca tu índice real), mide
archivos/s, la mediana de latencia de búsqueda y el RSS, y borra todo al salir.

## Roadmap

La visión completa (fases, rutas de IA y proveedores gratuitos) está en
[docs/ROADMAP.md](docs/ROADMAP.md). Estado actual: **fases 1-8 implementadas**.

## Limitaciones

- **La búsqueda "semántica" es léxica por defecto.** Sin configurar nada, los
  vectores usan *feature hashing* (solapamiento léxico tolerante a erratas),
  no significado: una paráfrasis sin palabras en común no aparecerá. Para
  semántica real, activa el proveedor `onnx` (ver más arriba); es opcional y
  requiere instalar un runtime y un modelo local.
- **El índice semántico se puntúa en CPU sobre todos los fragmentos con
  vector** (escaneo lineal). Es suficiente para corpus personales (decenas de
  miles de fragmentos), pero no está pensado para millones.
- Las herramientas opcionales (PDF, OCR, transcripción) requieren binarios
  externos; sin ellos esas partes simplemente se omiten.

## Privacidad y seguridad

- El servidor escucha **solo en loopback** y sirve la GUI desde ahí. Un `--host`
  no local sin `--allow-remote` se rechaza al arrancar, para que el índice no
  quede expuesto por descuido (la API no tiene autenticación).
- Las respuestas de la GUI llevan `Content-Security-Policy` (sin recursos
  externos ni scripts inline), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`; el servidor de
  ficheros está confinado a `web/`.
- La API rechaza peticiones con un `Origin` que no sea de `localhost`/`127.0.0.1`
  ni de una extensión de navegador, de modo que una web que visites no puede
  leer ni escribir en tu índice. Las extensiones solo hablan con
  `127.0.0.1`/`localhost`.
- Sin nube y sin telemetría: toda la recuperación ocurre en tu máquina. El
  único tráfico de red es hacia el proveedor RAG que configures (opcional).

## Contribuir

- [CONTRIBUTING.md](CONTRIBUTING.md) — cómo montar el proyecto, qué se ejecuta antes de un PR y la regla cero (**sin dependencias**).
- [SECURITY.md](SECURITY.md) — modelo de amenazas y reporte privado de vulnerabilidades.
- [CHANGELOG.md](CHANGELOG.md) — qué cambió en cada versión.
- [docs/ROADMAP.md](docs/ROADMAP.md) — visión, fases y rutas de IA.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — código de conducta.

## Licencia

MIT. Ver [LICENSE](LICENSE).
