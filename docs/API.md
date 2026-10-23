# API local

`memex serve` publica la API y la GUI en **loopback** (`http://127.0.0.1:4747`
por defecto). La API **no tiene autenticación**: escuchar fuera de loopback exige
`--allow-remote` y solo tiene sentido en una red de confianza.

- Respuestas en JSON UTF-8 con `cache-control: no-store`.
- Errores: `{ "error": "mensaje" }` con el código HTTP adecuado.
- CORS: solo se refleja para `localhost`, `127.0.0.1`, `::1` y extensiones
  (`chrome-extension://`, `moz-extension://`). Cualquier otro `Origin` recibe
  **403** y nunca se refleja su cabecera CORS.
- Cuerpo máximo: **8 MB**; `limit` máximo: **100**.

## Resumen

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Vida y versión (`{ok, name, version}`). |
| `GET` | `/api/stats` | Archivos, fragmentos, vectores, trails y extensiones. |
| `GET` | `/api/search?q=&mode=&any=&limit=` | Búsqueda híbrida, léxica o semántica. |
| `GET` | `/api/relate?ref=&limit=` | Documentos afines a una ruta o consulta. |
| `GET` | `/api/trails` | Lista de trails con número de nodos y enlaces. |
| `GET` | `/api/trails/:name?format=` | Grafo del trail (`json` D3, `dot`, `mermaid`, `md`). |
| `POST` | `/api/trails/:name` | Añade nodo (`{ref,note}`) o enlace (`{from,to,label}`). |
| `POST` | `/api/save` | Guarda un documento (`{url,title,text}`). |
| `POST` | `/api/ask` | Pregunta RAG (`{question,limit?}`). |
| `POST` | `/api/index` | Indexa una carpeta (`{path}`). |
| `POST` | `/api/embed` | Indexa y calcula vectores (`{path,force?}`). |
| `GET` | `/api/tools` | Herramientas opcionales y capacidades. |
| `GET` | `/api/config` | Configuración efectiva resumida. |

## Búsqueda

```bash
curl 'http://127.0.0.1:4747/api/search?q=ansiedad&mode=hybrid&limit=20'
```

| Parámetro | Valores | Defecto |
| --- | --- | --- |
| `q` | texto no vacío | — (obligatorio) |
| `mode` | `hybrid`, `lexical`, `semantic` | `hybrid` |
| `any` | `1`/`true` para OR | AND |
| `limit` | entero 1–100 | 20 |

Respuesta:

```json
{
  "query": "ansiedad",
  "mode": "hybrid",
  "took_ms": 7,
  "results": [
    {
      "file_id": 1,
      "path": "/home/yo/notas/diario.md",
      "name": "diario.md",
      "ext": ".md",
      "chunk_index": 0,
      "snippet": "Hoy hable de la [[ansiedad]] y del proyecto X …",
      "score": 0.0325,
      "lexical_rank": 0,
      "semantic_rank": 0,
      "lexical_score": -1.42,
      "semantic_score": 0.61
    }
  ]
}
```

`lexical_rank`/`semantic_rank` en `null` indican que el hit no vino de esa rama.
Con el proveedor `hash` la rama semántica es **léxica** (tolera erratas, no
sinónimos); con `onnx` es semántica real.

## Guardar e indexar

```bash
curl -X POST http://127.0.0.1:4747/api/save \
  -H 'content-type: application/json' \
  -d '{"url":"https://ejemplo.test/nota","title":"Nota","text":"calma y serenidad"}'

curl -X POST http://127.0.0.1:4747/api/index \
  -H 'content-type: application/json' -d '{"path":"/home/yo/Documentos"}'
```

`/api/index` valida que `path` exista y sea una carpeta (**400** si no), indexa de
forma asíncrona (cede el event loop entre archivos) y devuelve el resumen:

```json
{
  "root": "/home/yo/Documentos",
  "scanned": 120,
  "added": 3,
  "updated": 1,
  "unchanged": 112,
  "unsupported": 4,
  "failed": 0,
  "pruned": 2,
  "embedded": null
}
```

- `pruned`: archivos que estaban en el índice bajo esa carpeta y ya no existen.
- `embedded`: vectores calculados en la petición (solo con ONNX; con `hash` es
  `null` porque se calculan durante el indexado).

`/api/embed` hace lo mismo y además vectoriza lo pendiente; acepta
`{"force": true}` para recalcular todos los vectores (necesario al cambiar de
proveedor o dimensión).

## Preguntar

```bash
curl -X POST http://127.0.0.1:4747/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"¿qué conclusiones saqué del proyecto X?","limit":6}'
```

```json
{
  "answer": "Según [1], …",
  "model": "llama3.2",
  "offline": false,
  "context": [{ "n": 1, "file_id": 1, "name": "diario.md", "path": "…", "text": "…", "score": 0.03 }]
}
```

Sin proveedor configurado devuelve `answer: null`, `offline: true` y el contexto.
Si el proveedor falla, añade `error` sin lanzar un 500.

## Trails

```bash
curl http://127.0.0.1:4747/api/trails
curl http://127.0.0.1:4747/api/trails/proyecto-x
curl 'http://127.0.0.1:4747/api/trails/proyecto-x?format=mermaid'
curl -X POST http://127.0.0.1:4747/api/trails/proyecto-x \
  -H 'content-type: application/json' -d '{"ref":"/ruta/nota.md","note":"origen"}'
curl -X POST http://127.0.0.1:4747/api/trails/proyecto-x \
  -H 'content-type: application/json' -d '{"from":"/ruta/a.md","to":"/ruta/b.md","label":"relacionado"}'
```

`GET` sin `format` devuelve el grafo listo para D3 (`{trail,nodes,links}`). Un
trail inexistente responde **404**.

## Diagnóstico

```bash
curl http://127.0.0.1:4747/api/tools
curl http://127.0.0.1:4747/api/config
curl http://127.0.0.1:4747/api/health
```

## Códigos de estado

| Código | Cuándo |
| --- | --- |
| 200 | Correcto. |
| 204 | Preflight CORS (`OPTIONS`) permitido. |
| 400 | Falta `q`/`path`/`text`, `mode` o `limit` inválidos, JSON roto, carpeta inexistente. |
| 403 | `Origin` no permitido. |
| 404 | Endpoint o trail inexistente. |
| 413 | Cuerpo mayor de 8 MB. |
| 500 | Error interno inesperado (no se filtra la traza). |

## Clientes

- **GUI**: `web/` consume esta misma API (mismo origen, sin CORS).
- **Extensión MV3**: `POST /api/save` desde `chrome-extension://…`.
- **MCP**: no usa HTTP; `memex mcp` habla JSON-RPC por stdio.
