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
- Búsqueda full-text **y** semántica: por palabras exactas o por significado.
- Preguntas en lenguaje natural, con citas a los archivos locales.
- Trails asociativos entre documentos, exportables.
- Un servidor local con GUI web y una extensión de navegador.

## Fases

| Fase | Qué | Estado | Módulo |
| --- | --- | --- | --- |
| 1 | CLI que indexa una carpeta y permite búsqueda full-text | ✅ Hecho | `src/indexer.js`, `src/db.js`, `src/query.js` |
| 2 | Búsqueda semántica con embeddings en CPU + fusión RRF | ✅ Hecho | `src/embeddings.js`, `src/search.js` |
| 3 | OCR para imágenes y PDFs escaneados | ✅ Hecho (opcional) | `src/ocr.js` |
| 4 | Transcripción de audio/vídeo | ✅ Hecho (opcional) | `src/media.js` |
| 5 | Preguntas y respuestas con RAG (proveedor opcional) | ✅ Hecho | `src/rag.js` |
| 6 | GUI de escritorio / web | ✅ Hecho (web) | `src/server.js`, `web/` |
| 7 | Trails: grafo de relaciones entre documentos | ✅ Hecho | `src/trails.js` |
| 8 | Extensión de navegador para guardar páginas | ✅ Hecho | `extension/` |

## Rutas de IA (todas opcionales)

### Ruta 1 — MVP puro, sin IA

Búsqueda full-text (SQLite FTS5, ranking BM25) más búsqueda "por significado"
mediante *feature hashing* sobre unigramas, bigramas y trigramas. Todo local,
determinista y sin dependencias. Es la base y funciona siempre.

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
`Ollama`, `LM Studio`) vía `base_url`, en cuyo caso no se necesita clave.

### Ruta 3 — LLM local ultraligera (futuro)

Modelos de ~300M de parámetros (~328 MB cuantizados) que corren en CPU para
validar el flujo completo sin conexión. Es el siguiente paso natural para cerrar
el círculo "100% offline también en la generación".

## Cómo acercar el proyecto a la comunidad

1. Ruta 1 sólida: un CLI que indexa una carpeta y busca. Graba un GIF corto.
2. README claro: funciona sin LLM y la capa de IA es opcional. Diferenciador
   frente a proyectos que asumen GPU.
3. Documenta benchmarks en un equipo modesto (tiempo de indexado, de búsqueda,
   RAM). Genera confianza.
4. Publica en r/selfhosted, r/LocalLLaMA y r/DataHoarder con el ángulo:
   *"Construí un Memex offline que funciona sin GPU y sin LLM local"*.
5. Añade la capa de API remota como extra opcional.
