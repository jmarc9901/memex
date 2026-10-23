# Memex Offline — Visión y roadmap

> Este documento es la visión a largo plazo del proyecto. El estado "hecho" de
> cada fase se refiere a lo implementado hoy en este repositorio. Para el uso
> diario consulta el [README](../README.md).

## La idea

En 1945 Vannevar Bush describió el **Memex**: un dispositivo donde una persona
almacena todos sus libros, documentos y comunicaciones, y puede consultarlos con
velocidad y flexibilidad, creando *trails* (caminos asociativos) entre ellos.

Nunca se realizó por completo. Hoy tenemos la nube, pero está fragmentada, es
privativa y depende de internet. Memex Offline quiere ser ese Memex moderno:
**offline, multimodal, privado y de código abierto**.

Principios:

- **Offline-first**: sin nube y sin telemetría. La red es siempre opcional.
- **Sin GPU obligatoria**: corre en CPU, incluso en equipos modestos.
- **Sin dependencias**: solo Node.js (usa el `node:sqlite` integrado).
- **Degradación con gracia**: si falta una herramienta (Tesseract, ffmpeg…),
  esa parte se omite y el resto sigue funcionando.

## Qué haría Memex Offline

- Indexar todo el disco: PDFs, TXT, Markdown, código, imágenes (OCR), audio y
  vídeo (transcripción), páginas web guardadas.
- Búsqueda full-text **y** semántica: por palabras exactas, por similitud léxica
  tolerante a erratas o, opcionalmente, por significado con embeddings
  neuronales locales (ver Ruta 1).
- Preguntas en lenguaje natural, con citas a los archivos locales.
- Trails asociativos entre documentos, exportables.
- Un servidor local con GUI web y una extensión de navegador.
- Un servidor **MCP** local (stdio) para que los agentes de IA consulten tu
  índice sin subir nada a la nube.

## Fases

| Fase | Qué | Estado | Módulo |
| --- | --- | --- | --- |
| 1 | CLI que indexa una carpeta y permite búsqueda full-text | ✅ Hecho | `src/indexer.js`, `src/db.js`, `src/query.js` |
| 2 | Búsqueda difusa (embeddings léxicos en CPU) + fusión RRF | ✅ Hecho | `src/embeddings.js`, `src/search.js` |
| 3 | OCR de imágenes | ✅ Hecho (opcional; los PDFs escaneados sin capa de texto no se rasterizan) | `src/ocr.js` |
| 4 | Transcripción de audio/vídeo | ✅ Hecho (opcional) | `src/media.js` |
| 5 | Preguntas y respuestas con RAG (proveedor opcional) | ✅ Hecho | `src/rag.js` |
| 6 | GUI de escritorio / web | ✅ Hecho (web) | `src/server.js`, `web/` |
| 7 | Trails: grafo de relaciones entre documentos | ✅ Hecho | `src/trails.js` |
| 8 | Extensión de navegador para guardar páginas | ✅ Hecho | `extension/` |
| 9 | LLM local: detección de servidores y auto-selección de modelo | ✅ Hecho | `src/rag.js`, `src/doctor.js` |
| 10 | Indexado de archivos comprimidos (ZIP y gzip) | ✅ Hecho | `src/archive.js` |
| 11 | Embeddings neuronales opcionales (ONNX) para semántica real | ✅ Hecho (opcional) | `src/onnx.js`, `src/embeddings.js` |
| 12 | Gestión de configuración por CLI (`memex config`) | ✅ Hecho | `src/config.js`, `src/cli.js` |
| 13 | Índice vectorial en memoria + prefiltro binario (escala) | ✅ Hecho | `src/vectorstore.js` |
| 14 | Servidor MCP local (stdio) para agentes de IA | ✅ Hecho | `src/mcp.js` |
| 15 | Onboarding en un comando (`memex init`) | ✅ Hecho | `src/init.js` |
| 16 | Endurecimiento y coherencia: poda de borrados, rutas validadas, caché entre procesos, batching y modelos cased | ✅ Hecho (0.4.0) | `src/indexer.js`, `src/onnx.js`, `src/vectorstore.js` |
| 17 | Calidad y documentación: tests de UI/extensión, API y arquitectura, assets e iconos | ✅ Hecho (0.4.0) | `test/`, `docs/`, `assets/` |

## Rutas de IA (todas opcionales)

### Ruta 1 — MVP puro, sin IA

Búsqueda full-text (SQLite FTS5, ranking BM25) más búsqueda difusa mediante
*feature hashing* sobre unigramas, bigramas y trigramas de caracteres. Es una
coincidencia **léxica** tolerante a erratas (no entiende sinónimos ni
paráfrasis sin palabras en común). Todo local, determinista y sin
dependencias: es la base y funciona siempre.

La **semántica neuronal real es opcional** (Fase 11): con `embed_provider:
"onnx"` y un modelo BERT local (all-MiniLM-L6-v2) se calculan embeddings de
significado con `memex embed`. Requiere instalar `onnxruntime-node` y apuntar
`embed_model` al .onnx; si falta algo, se avisa y se cae al proveedor `hash`. El
proveedor neuronal vectoriza por lotes y respeta mayúsculas/acentos con modelos
*cased* (el multilingüe).

### Ruta 2 — Capa de IA opcional (API compatible OpenAI)

El motor de recuperación (Ruta 1) obtiene los fragmentos más relevantes, se
construye un prompt con ellos y la generación se delega a una API remota **solo
si el usuario configura una clave o un `base_url`**. Si no, `memex ask` devuelve
los fragmentos para leerlos directamente.

Proveedores con tiers gratuitos que encajan:

| Proveedor | Límite gratuito | Ventaja |
| --- | --- | --- |
| GroqCloud | límites diarios por modelo | inferencia muy rápida |
| OpenRouter | 20 RPM, 50 RPD | 25+ modelos gratis con una clave |
| Google Gemini API | uso gratuito en modelos seleccionados | límites de tokens generosos |
| Cloudflare Workers AI | 10.000 neuronas/día | sin tarjeta de crédito |

También vale cualquier endpoint local compatible con OpenAI (`llama.cpp`,
`Ollama`, `LM Studio`), ya sea indicando `base_url` o usando los presets
`llamacpp`, `ollama` y `lmstudio`; en ese caso no se necesita clave.

### Ruta 3 — LLM local ultraligera

Implementada la integración: `memex models` y `memex doctor --ping` detectan
servidores locales (presets `ollama`, `llamacpp`, `lmstudio`) y `memex ask`
auto-selecciona el primer modelo disponible si no configuras `rag.model`. Basta
con descargar un modelo pequeño (p. ej. ~300M de parámetros, ~328 MB
cuantizados) y tenerlo servido en local: el flujo completo queda offline, sin
clave ni conexión. La calidad de las respuestas depende del modelo elegido.

## Cómo acercar el proyecto a la comunidad

1. Ruta 1 sólida: un CLI que indexa una carpeta y busca. Graba un GIF corto.
2. README claro: funciona sin LLM y la capa de IA es opcional. Diferenciador
   frente a proyectos que asumen GPU.
3. Documenta benchmarks en un equipo modesto (tiempo de indexado, de búsqueda,
   RAM). Genera confianza.
4. Publica en r/selfhosted, r/LocalLLaMA y r/DataHoarder con el ángulo:
   *"Construí un Memex offline que funciona sin GPU y sin LLM local"*.
5. Añade la capa de API remota como extra opcional. ✅ Hecho (Ruta 2).
6. Documenta los embeddings neuronales opcionales (ONNX) como diferenciador
   sin GPU obligatoria. ✅ Documentado en el README.
