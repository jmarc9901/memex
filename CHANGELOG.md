# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
versionado [semántico](https://semver.org/lang/es/).

Aviso de honestidad: el proyecto **no tuvo etiquetas (tags)** hasta la `v0.3.0`,
así que las entradas anteriores se reconstruyeron a partir del histórico de git y
de [`docs/ROADMAP.md`](docs/ROADMAP.md), no de notas de release. Además, la
**`0.2.0` nunca existió**: `package.json` pasó de `0.1.0` a `0.3.0` en un salto.

## [0.4.0] - 2026-10-23

### Añadido

- **Poda de archivos borrados**: reindexar elimina del índice los documentos que
  ya no existen bajo esa carpeta. Solo afecta a la raíz indexada (indexar `~/A`
  nunca borra `~/B`) y se puede desactivar con `--no-prune`. El resumen del CLI,
  la GUI y la API informan de `pruned`.
- **Indexado asíncrono en el servidor** (`indexFolderAsync`): cede el event loop
  entre archivos para que la GUI y la API no se congelen al indexar carpetas
  grandes. El CLI mantiene la variante síncrona.
- **Embeddings ONNX por lotes**: `embedder.batch(texts)` procesa 16 fragmentos por
  pasada; si un lote falla, se reintenta de uno en uno para no perder ninguno.
- **Soporte de modelos *cased***: `embed_cased` (y `MEMEX_EMBED_CASED`) conserva
  mayúsculas y acentos para el BERT multilingüe. El MiniLM inglés sigue *uncased*.
- **Umbral semántico por proveedor**: 0.1 con `hash`, 0.3 con `onnx`; los cosenos
  neuronales son mucho más altos y el umbral antiguo dejaba pasar ruido.
- **Invalidación de la caché vectorial entre procesos** con `PRAGMA data_version`:
  `memex serve` ya no devuelve resultados viejos cuando `memex index` escribe
  desde otra terminal.
- **Validación de rutas**: indexar una ruta inexistente o un archivo suelto es un
  error claro (400 en la API, exit 1 en el CLI) en vez de un éxito con ceros.
- **Tope de resultados en el CLI** (1–100), igual que en la API.
- **La UI expone más API**: documentos relacionados por resultado, selector de
  límite, botón «Indexar + vectores» y resumen de indexado con eliminados.
- **Accesibilidad de la GUI**: `aria-selected`/`aria-controls`, paneles
  `tabpanel`, `aria-live` en los mensajes, navegación con flechas entre pestañas y
  atajo `/` para buscar.
- **Helpers puros de la UI** en `web/lib.js`, con tests en Node (sin navegador).
- **Tests de la extensión** con la API de Chrome simulada y **tests de la poda,
  del batching, del tokenizer cased y de la caché entre conexiones**, además de
  los comandos de trail/relate/embed/doctor/clear y los endpoints de trails y
  embed. La suite pasa de 118 a 149 pruebas y la cobertura se ejecuta con
  umbrales (82 % líneas, 72 % ramas, 84 % funciones) que rompen el CI si bajan.
- **Iconos de la extensión** generados por código (`scripts/make-icons.js`, sin
  dependencias) y declarados en el manifest.
- **Documentación nueva**: [docs/API.md](docs/API.md),
  [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), `CITATION.cff` y banner/logo SVG.
- `--force-download` para volver a bajar el modelo ONNX a propósito.

### Cambiado

- **Mínimo de Node: 24.0** (antes 22.13). El SQLite que trae Node 22.13 no compila
  FTS5 y el índice fallaba con `no such module: fts5`; la matriz de CI lo detectó
  en las tres plataformas. Node 24 es la primera línea con FTS5 en `node:sqlite`.
  La guardia de `bin/memex.js`, `engines`, los instaladores y la matriz de CI
  (24/26) se alinean con ese mínimo.
- **`memex init` reutiliza el modelo ya descargado**: antes volvía a bajar 23 MB
  (o 180 MB) en cada ejecución.
- `POST /api/index` y `POST /api/embed` validan `path` y responden **400** si no
  existe o no es una carpeta.
- Las respuestas de la API llevan `cache-control: no-store`.
- `README.md` y `README.en.md` quedan sincronizados sección a sección y
  reescritos con banner, índice, tabla comparativa y estado real del proyecto.
- La versión del paquete y de la extensión pasan a **0.4.0**.
- El README en inglés ya no omite secciones (extensión, benchmarks, roadmap, LLM
  local) que sí estaban en español.

### Corregido

- **Los archivos borrados del disco ya no se quedan en el índice** (el caso más
  visible: resultados con rutas muertas y estadísticas infladas).
- **El tokenizer ONNX ya no fuerza minúsculas sin acentos** en modelos *cased*.
- `memex init` ya no dice «Listo» tras un indexado que no indexó nada por una
  ruta inválida.
- `isLocal` comparaba una regex sobre la URL completa: `http://localhost.evil.example`
  se trataba como local. Ahora se compara el `hostname` con `new URL()`.
- `whisperAvailable` ya no detecta cualquier binario llamado `main` del `PATH`
  como transcripción disponible.
- La conversión a WAV de audio compara la extensión en minúsculas (`.WAV`).
- El `CHANGELOG` afirmaba que el tarball de npm incluía `package-lock.json`; no es
  así. El lockfile está en el repositorio (para `npm ci` y auditoría), no en el
  paquete publicado.
- `docs/ROADMAP.md` atribuía OCR a PDFs escaneados; no existe rasterizado + OCR.
- `--no-model` en el instalador de la UI limpia las rutas de modelo anteriores en
  vez de dejar una configuración incoherente.
- `--force` (reindexar) ya no provoca una redescarga del modelo: eso es
  `--force-download`.

## [0.3.0] - 2026-10-11

### Añadido

- Embeddings neuronales **opcionales** (ONNX: tokenizer WordPiece, mean pooling y
  normalización L2) con caída automática a `hash`, más el comando `memex embed`.
- Índice vectorial en memoria con prefiltro binario (popcount) antes del coseno
  exacto, para escalar la búsqueda semántica.
- Servidor **MCP** local por stdio (`memex mcp`) para agentes de IA y onboarding
  en un comando (`memex init`).
- `memex config` (ver y editar la configuración efectiva) y presets de proveedor
  RAG (Groq, OpenRouter, Gemini, Ollama, llama.cpp, LM Studio).

### Cambiado

- Endurecimiento del CORS a `localhost` y extensiones de navegador.
- Reindexado atómico por archivo y cálculo del hash sin releer el fichero.

## [0.1.0] - 2026-10-09

### Añadido

- Motor de búsqueda **full-text offline** (SQLite FTS5 + BM25) con indexado
  incremental y CLI (`index`, `search`, `stats`, `clear`, `export`).
- Búsqueda difusa con embeddings en CPU (feature hashing de unigramas, bigramas y
  trigramas) y fusión híbrida por **Reciprocal Rank Fusion**.
- OCR de imágenes (`tesseract`) y transcripción de audio/vídeo (`whisper`),
  ambas opcionales y con degradación con gracia.
- Trails asociativos entre documentos, RAG con proveedor opcional, servidor local
  con GUI web, extensión de navegador (MV3), detector de LLM locales,
  `doctor`/`bench`, indexado de ZIP/gzip y README en inglés. Licencia MIT.
