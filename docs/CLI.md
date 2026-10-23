# Referencia del CLI

`memex` es un unico binario (`bin/memex.js`) sin dependencias. Todos los
comandos aceptan `--db RUTA` para usar un indice distinto del de por defecto
(`./.memex/index.db` o `$MEMEX_DB`).

```bash
node bin/memex.js --help
node bin/memex.js <comando> --help   # ayuda general; los comandos no tienen ayuda propia
```

## Instalacion del comando

```bash
# Opcion 1: enlazar el comando global con npm
npm link

# Opcion 2: instalador con comprobaciones (Node, sintaxis y tests)
./install-cli.sh
install-cli.cmd
```

El instalador tambien acepta `--no-link`, `--skip-tests` y `--skip-check`.
Para usar el CLI sin enlazarlo: `node bin/memex.js ...`.

## Opciones comunes

| Opcion | Efecto |
| --- | --- |
| `--db RUTA` | Base de datos SQLite del indice. |
| `--force` | Reindexa todo, ignorando la cache por tamano/mtime. |
| `--force-download` | Vuelve a descargar el modelo ONNX aunque ya exista (`init`). |
| `--no-prune` | No elimina del indice los archivos borrados del disco (`index`). |
| `--no-embed` | Indexa solo texto (sin vectores). |
| `--mode hybrid\|lexical\|semantic` | Modo de busqueda. `hybrid` es el defecto. |
| `-n`, `--limit N` | Numero maximo de resultados (1–100; defecto 20). |
| `--any` | Une los terminos con OR en vez de AND. |
| `--format FMT` | Formato de `export` o `trail show`. |
| `-o`, `--out RUTA` | Archivo de salida de `export`. |
| `--json` | Salida legible por maquinas. |
| `--host`, `--port` | Direccion del servidor (`serve`). |
| `--allow-remote` | Permite `serve` fuera de loopback (sin autenticacion). |

Los flags desconocidos se avisan por **stderr** y se ignoran, para no romper la
salida JSON de stdout.

## Onboarding

```bash
memex init ~/Documentos
```

Detecta el hardware, elige un modelo de embeddings, escribe la configuracion,
indexa la carpeta y calcula los vectores. Si no hay red o el modelo falla, cae a
los embeddings `hash` sin dejar el indice a medias.

| Flag | Efecto |
| --- | --- |
| `--no-model` | No descarga nada; usa `hash` (256 dims). |
| `--model RUTA` | Usa un `.onnx` local. |
| `--tokenizer RUTA` | `vocab.txt` del modelo. |
| `--dim N` | Fuerza la dimension (entero >= 8; debe coincidir con el modelo). |
| `--force-download` | Ignora la cache local del modelo y lo descarga otra vez. |
| `--lang en\|es` | `en` usa MiniLM (~23 MB); `es` usa BERT multilingue (~180 MB). |
| `--quality auto\|speed\|best` | Prioriza el modelo mas pequeno o el de mas calidad. |

El idioma por defecto del CLI es `en` para que el onboarding sea ligero. Para
corpus en espanol usa `--lang es` (o el instalador de la UI, que ya lo hace).

Si el modelo y el `vocab.txt` ya estan en `~/.memex/models`, `init` los reutiliza;
no vuelve a descargar 23 MB (ni 180 MB) en cada ejecucion. `--force` solo fuerza
el reindexado; para volver a bajar el modelo usa `--force-download`.

## Indexar

```bash
memex index ~/Documentos
memex index ~/Documentos --force
memex index ~/Documentos --no-embed --json
```

El indexado es incremental por tamano y `mtime` (milisegundos). Ademas, reindexar
**elimina del indice los archivos que ya no existen** bajo esa carpeta: el resumen
muestra cuantos se han eliminado (`eliminados` / `pruned`). La poda solo toca rutas
dentro de la raiz indexada (indexar `~/A` nunca borra `~/B`) y se desactiva con
`--no-prune`.

Una ruta inexistente o un archivo suelto son un error de uso (exit 1), no una
carpeta vacia. Se ignoran `.git`, `node_modules`, `dist`, `build`, `__pycache__`,
`.venv`, binarios y archivos de mas de 25 MB.

Formatos soportados: texto/Markdown/codigo, PDF (con `pdftotext` o `mutool`),
imagenes (OCR con `tesseract`), audio/video (con `whisper-cli`/`whisper` y
`ffmpeg`), ZIP/gzip de texto y paginas guardadas desde la extension.

## Buscar

```bash
memex search "ansiedad"
memex search '"proyecto x" 2024'          # frase exacta
memex search "informe*"                    # prefijo
memex search "ansiedad embeddings" --any   # OR
memex search "como me sentia" --mode semantic
memex search "ansiedad" -n 5 --json
```

- `lexical`: FTS5 + BM25. Exacto y predecible.
- `semantic`: similitud de vectores. Con el proveedor por defecto (`hash`) es
  **lexica**, tolerante a erratas, no entiende sinonimos sin palabras comunes.
- `hybrid`: fusiona ambas listas con Reciprocal Rank Fusion (RRF).

Los aciertos incluyen `lexical_rank`/`semantic_rank` para saber de que rama
vienen. `--json` devuelve `{query, mode, took_ms, count, results}`.

## Preguntar (RAG opcional)

```bash
memex ask "¿que conclusiones saque del proyecto X?"
memex ask "resumen de las notas de viaje" -n 8 --json
```

Sin proveedor configurado devuelve los fragmentos recuperados y sus citas
(`offline: true`). Con `rag.base_url`/`rag.api_key` configurados, envia el
contexto al proveedor (OpenAI-compatible, Groq, OpenRouter, Gemini, Ollama,
llama.cpp o LM Studio) y devuelve la respuesta generada. La generacion nunca es
obligatoria.

## Exportar

```bash
memex export "ansiedad" --format jsonl
memex export "ansiedad" --format csv -o ansiedad.csv
memex export "ansiedad" --format md -o ansiedad.md
```

`jsonl` es el formato por defecto. `csv` escapa comas y comillas; `md` genera un
informe con ruta, puntuacion y extracto. `-n` se acota a 100 resultados, igual que
en la API, para no materializar medio indice con una errata.

## Relaciones y trails

```bash
memex relate ~/notas/proyecto.md
memex relate "ansiedad" -n 5 --json

memex trails
memex trail create proyecto-x --desc "como llegue a las conclusiones"
memex trail add proyecto-x ~/notas/proyecto.md --note "borrador"
memex trail link proyecto-x ~/notas/proyecto.md ~/notas/revision.md
memex trail suggest proyecto-x -n 5
memex trail show proyecto-x
memex trail show proyecto-x --format dot
memex trail show proyecto-x --format mermaid
memex trail show proyecto-x --format md
memex trail rm proyecto-x
```

`trail show` acepta `json` (defecto), `dot`, `mermaid` y `md`. Los trails se
guardan en el mismo SQLite que el indice y se exportan sin dependencias.

## Servidor y GUI

```bash
memex serve
memex serve --port 8080
memex serve --host 0.0.0.0 --allow-remote   # solo en redes de confianza
```

La API no tiene autenticacion. Escuchar fuera de loopback se rechaza salvo
`--allow-remote`; la GUI y la extension hablan con `127.0.0.1`/`localhost`.
Rutas principales: `/api/health`, `/api/stats`, `/api/search`, `/api/relate`,
`/api/trails`, `/api/save`, `/api/ask`, `/api/index`, `/api/embed`,
`/api/tools` y `/api/config`. La referencia y los ejemplos estan en el
[README](../README.md#interfaz-grafica-web).

## Embeddings y modelos

```bash
memex embed ~/Documentos
memex embed ~/Documentos --force
```

Calcula los vectores pendientes (o todos con `--force`). Es obligatorio tras
cambiar de proveedor o de dimension. Con `onnx`, el indexado normal solo escribe
texto; despues hay que ejecutar `embed` (o usar `/api/index`, que ya lo hace).

El proveedor neuronal procesa **lotes de 16 fragmentos** por pasada (con reintento
individual si un lote falla) y respeta mayusculas y acentos cuando el modelo es
*cased* (`embed_cased: true`, el BERT multilingue). El MiniLM ingles sigue
normalizando a minusculas sin acentos.

```bash
memex config show
memex config path
memex config set embed_provider onnx
memex config set embed_dim 384
memex config set embed_model ~/.memex/models/all-MiniLM-L6-v2/model_quantized.onnx
```

Si `onnxruntime-node` o el modelo no existen, se avisa y se usa `hash`. Cambiar
de proveedor sin recalcular vectores hace que la busqueda semantica descarte los
resultados por dimension incompatible (aviso `MEMEX_EMBED_DIM_MISMATCH`).

El umbral de similitud depende del proveedor: 0.1 con `hash` y 0.3 con `onnx`
(los cosenos neuronales son mas altos incluso entre textos sin relacion).

Un modelo *cased* se configura con `config set embed_cased true` o
`MEMEX_EMBED_CASED=1`; un modelo *uncased* debe dejarlo en `false`.

## Diagnostico, modelos y benchmark

```bash
memex doctor
memex doctor --ping
memex doctor --json
memex models
memex bench ~/Documentos
memex bench ~/Documentos "consulta" -n 10 --json
```

`doctor` comprueba binarios opcionales y configuracion. `models` lista los
modelos de servidores LLM locales detectados. `bench` indexa en un indice
temporal y mide archivos/s, latencia de busqueda y RSS; no toca el indice real.

## Estadisticas y limpieza

```bash
memex stats
memex stats --json
memex clear
```

`clear` borra documentos, fragmentos, vectores y trails del indice indicado.

## Servidor MCP

```bash
memex mcp
```

Expone por stdio las herramientas `memex_search`, `memex_ask`, `memex_relate`,
`memex_trails`, `memex_trail_show`, `memex_stats` y `memex_index` para clientes
MCP (Claude Desktop, Cursor, Continue...). Ejemplo de configuracion:

```json
{
  "mcpServers": {
    "memex": { "command": "node", "args": ["/ruta/a/memex/bin/memex.js", "mcp"] }
  }
}
```

## Configuracion

Precedencia: variables de entorno > archivo > valores por defecto. El archivo se
busca en `$MEMEX_CONFIG`, `./.memex/config.json` y `~/.memex/config.json`.

Variables: `MEMEX_DB`, `MEMEX_CONFIG`, `MEMEX_MODELS_DIR`,
`MEMEX_EMBED_PROVIDER`, `MEMEX_EMBED_DIM`, `MEMEX_EMBED_MODEL`,
`MEMEX_EMBED_TOKENIZER`, `MEMEX_EMBED_MAX_LEN`, `MEMEX_EMBED_CASED`,
`MEMEX_RAG_API_KEY`, `MEMEX_RAG_BASE_URL`, `MEMEX_RAG_MODEL`,
`MEMEX_RAG_PROVIDER`, `MEMEX_PORT`, `MEMEX_OCR_LANG`, `MEMEX_WHISPER_MODEL`.

## Codigos de salida

- `0`: correcto.
- `1`: error de uso, archivo inexistente, fallo de red/modelo o error interno.

Los errores se escriben por stderr; la salida JSON de stdout no se mezcla con
avisos. `npm test` cubre el parser, el ranking, la poda, el batching, la API, el
servidor MCP, la extension y los instaladores.
