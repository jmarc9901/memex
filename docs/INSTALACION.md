# Instalacion

Memex Offline solo necesita **Node.js**. No hay dependencias npm obligatorias:
el motor usa `node:sqlite`, `node:http`, `node:zlib` y `node:test` de la
biblioteca estandar.

## Requisitos

- **Node.js >= 24** (probado con Node 26). El SQLite integrado de Node 22.13 no
  compila FTS5 y el indice falla con `no such module: fts5`; por eso el minimo es
  24. `bin/memex.js` comprueba la version y da un error claro.
- Opcional, solo para funciones extra:
  - `pdftotext` (poppler) o `mutool` (mupdf) para PDFs.
  - `tesseract` para OCR de imagenes.
  - `whisper-cli` (whisper.cpp) o `whisper` de Python, y `ffmpeg`, para
    transcribir audio/video.
  - `onnxruntime-node` + un modelo ONNX local para semantica neuronal real.

Comprueba lo que tienes con:

```bash
node bin/memex.js doctor
```

## Instalacion rapida (CLI)

```bash
git clone https://github.com/jmarc9901/memex.git
cd memex
node bin/memex.js --help
```

Para tener el comando `memex` en el `PATH`, cualquiera de estas dos opciones:

```bash
# Enlaza el paquete con npm
npm link

# O usa el instalador, que comprueba Node, sintaxis y tests antes de enlazar
./install-cli.sh          # Linux/macOS
install-cli.cmd           # Windows
```

El instalador acepta `--no-link` (solo comprueba), `--skip-tests` y
`--skip-check`. Si `npm link` falla por permisos, sigue funcionando
`node bin/memex.js ...`.

## Primer indice

```bash
# Onboarding: elige modelo, escribe config, indexa y calcula vectores
memex init ~/Documentos

# Si no quieres descargar modelo (empieza ligero y 100% lexical)
memex init ~/Documentos --no-model

# Corpus en espanol: modelo multilingue (~180 MB)
memex init ~/Documentos --lang es
```

`init` sin `--lang` usa `all-MiniLM-L6-v2` (~23 MB, 384 dims, ingles). Con
`--lang es` usa `bert-base-multilingual-cased` (~180 MB, 768 dims). Si la
descarga falla, la configuracion cae a `hash` y el indice sigue funcionando.

El modelo se guarda en `~/.memex/models` y **se reutiliza** en ejecuciones
posteriores: repetir `init` no vuelve a descargarlo. Para forzar la descarga usa
`--force-download`.

Despues:

```bash
memex search "ansiedad"
memex ask "¿que conclusiones saque del proyecto X?"
memex stats
memex serve
```

El indice vive en `./.memex/index.db` (o `$MEMEX_DB`, o `--db RUTA`). La
configuracion se guarda en `./.memex/config.json` o `~/.memex/config.json`;
`memex config path` dice cual esta activo.

## Instalacion de la UI

```bash
# Linux/macOS
./install-ui.sh ~/Documentos

# Windows
install-ui.cmd C:\Users\yo\Documentos
```

El instalador:

1. Detecta CPU, nucleos y RAM.
2. Elige un modelo segun `--lang` y `--quality`.
3. Lo descarga a `~/.memex/models` (o `$MEMEX_MODELS_DIR`).
4. Escribe la configuracion y, si no pasas `--no-index`, indexa la carpeta.
5. Crea `memex-ui.sh` y `memex-ui.cmd` en la carpeta actual.

Opciones:

| Flag | Efecto |
| --- | --- |
| `--no-model` | No descarga modelo; usa `hash`. |
| `--lang es\|en` | Idioma del corpus (por defecto `es`). |
| `--quality auto\|speed\|best` | Modelo mas pequeno o de mas calidad. |
| `--no-index` | Prepara modelo/config, sin indexar. |
| `--port N` | Puerto de la UI (por defecto 4747). |
| `--db RUTA` | Indice a usar. |
| `--start` | Arranca el servidor al terminar. |
| `--force` | Vuelve a descargar el modelo aunque ya exista. |

Despues abre la UI con doble clic en `memex-ui.cmd`/`memex-ui.sh`, o con
`memex serve` y visitando <http://127.0.0.1:4747>.

Nota: el modelo multilingue es mucho mas pesado. En equipos con poca RAM usa
`--quality speed` o `--no-model`; la busqueda lexical sigue siendo util.

## Extension de navegador (opcional)

1. Arranca `memex serve`.
2. En Chrome/Edge/Brave abre `chrome://extensions`, activa el **modo
   desarrollador** y pulsa **Cargar descomprimida**.
3. Selecciona la carpeta `extension/` del repositorio.
4. Usa el icono o el menu contextual para guardar la pagina o la seleccion.

La extension solo habla con `127.0.0.1`/`localhost`; no envia nada a internet.
Mas detalles en [extension/README.md](../extension/README.md).

## Embeddings neuronales opcionales

El paquete no incluye `onnxruntime-node` (regla cero: sin dependencias). Si lo
quieres, instalalo en el proyecto:

```bash
npm install onnxruntime-node
```

Y configura un modelo local:

```bash
memex config set embed_provider onnx
memex config set embed_dim 384
memex config set embed_model ~/.memex/models/all-MiniLM-L6-v2/model_quantized.onnx
memex embed ~/Documentos --force
```

`memex init --lang en` ya descarga ese modelo; solo falta el runtime. Si el
runtime o el modelo faltan, se avisa y se usa `hash`.

El tokenizer se adapta al modelo: los modelos *cased* (el multilingue) conservan
mayusculas y acentos (`embed_cased: true` o `MEMEX_EMBED_CASED=1`); el MiniLM
ingles se normaliza a minusculas sin acentos. La vectorizacion va por lotes de 16
fragmentos.

## Problemas frecuentes

**`node:sqlite` no existe o `no such module: fts5`.** Estás en Node < 24. El
SQLite de Node 22.13 no incluye FTS5. Actualiza a una version reciente
(`node -v`).

**El comando `memex` no aparece.** `npm link` no modifico el `PATH`. Ejecuta
`node bin/memex.js` o revisa la carpeta global de npm (`npm bin -g`).

**La descarga del modelo falla.** Sin red no se puede bajar; usa
`--no-model` o `--model /ruta/model.onnx`. El resto del proyecto sigue
funcionando con `hash`.

**El puerto 4747 esta ocupado.** Usa `memex serve --port 8080` o define
`MEMEX_PORT=8080`. El lanzador generado tambien acepta `--port` al instalarlo.

**La busqueda semantica no encuentra nada.** Comprueba `memex stats`: si
`con vector` es 0, ejecuta `memex embed` (o indexa con embeddings). Tras cambiar
de proveedor, `memex embed --force`.

**Borre archivos y siguen apareciendo.** Vuelve a ejecutar `memex index` sobre esa
carpeta: la poda elimina las rutas que ya no existen (el resumen muestra
`eliminados`). Si usaste `--no-prune`, esa es la causa.

**«no existe la carpeta» al indexar.** La ruta debe existir y ser una carpeta; ya
no se responde «0 archivos» ante una ruta invalida. Revisa la ruta o usa la
carpeta actual sin argumento.

**Quiero empezar de cero.** `memex clear` borra el indice; para borrar tambien
configuracion/modelos, elimina `./.memex` y `~/.memex` (revisa antes que no
haya nada que quieras conservar).

**Windows y los scripts `.sh`.** Usa los `.cmd` equivalentes; no necesitas WSL.

**`onnxruntime-node` no se instala o falla al cargar.** El paquete es nativo y
depende de la version de Node; si el instalador falla (por ejemplo, error
`3221225794` en Windows con Node 26), usa Node 24 LTS o la version que soporte el
runtime. Sin el runtime, Memex sigue funcionando con el proveedor `hash`.
