# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
versionado [semántico](https://semver.org/lang/es/).

Aviso de honestidad: el proyecto **no tenía etiquetas (tags)** hasta la `v0.3.0`,
así que las entradas de abajo se reconstruyeron a partir del histórico de git y
de [`docs/ROADMAP.md`](docs/ROADMAP.md), no de notas de release. Además, la
**`0.2.0` nunca existió**: `package.json` pasó de `0.1.0` a `0.3.0` en un salto.

## [Sin publicar]

### Añadido

- Test de calidad de recuperación (`test/quality.test.js`): corpus etiquetado de
  8 documentos y 8 consultas, con métricas **precision@1 / recall@3** (baseline
  medido: 1.00 y 1.00) y un test de caracterización de la frontera léxica del
  proveedor `hash`.
- Guardia de versión de Node en `bin/memex.js`: corta antes de importar y explica
  el motivo en lugar de fallar con un error opaco al cargar `node:sqlite`.
- `--allow-remote` en `serve`, que permite escuchar fuera de loopback de forma
  explícita.
- Cabeceras de seguridad en la GUI (`Content-Security-Policy`, `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`).
- Gobernanza del repositorio: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, plantillas de issue y PR, `CODEOWNERS`, Dependabot,
  `.editorconfig`, `.gitattributes` y este `CHANGELOG.md`.
- `npm run coverage` (cobertura integrada de `node --test`) y caché de npm en CI.

### Cambiado

- **Mínimo de Node y matriz de CI: 22.13.0** (antes 22.5.0). `node:sqlite` exigía
  `--experimental-sqlite` antes de 22.13, así que en 22.5.0 los tests no podían
  ni cargar `src/db.js`.
- `serve` rechaza escuchar fuera de loopback salvo `--allow-remote`: la API no
  tiene autenticación.
- El servido de estáticos se confina con `path.relative` en lugar de un prefijo
  de cadena.
- `bin/memex.js` pasa a modo `100755` (tiene shebang).
- La extensión declara la misma versión que el paquete (`0.3.0`).
- `package.json` declara `author` y el paquete incluye `package-lock.json` para
  permitir `npm ci` y auditoría.

### Corregido

- Un vector de consulta con dimensiones distintas a las del índice ya no se
  trunca en silencio: se avisa una vez y se descartan los resultados semánticos.
- Las opciones de CLI desconocidas se avisan por stderr (antes se ignoraban en
  silencio y por stdout rompían el `--json` de quien lo parsea).
- El test del prefiltro binario inserta sus 2000 fragmentos en una transacción:
  la suite completa pasa de ~127 s a ~23 s.

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
