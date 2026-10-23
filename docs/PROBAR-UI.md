# Probar la UI paso a paso

Esta guia comprueba la interfaz web y la API local. No necesita navegador
automatizado ni dependencias: sirve para una prueba manual rapida (o para
grabar el GIF del README).

## 1. Preparar un corpus

```bash
mkdir -p /tmp/memex-demo
cat > /tmp/memex-demo/diario.md <<'EOF'
Hoy hable de la ansiedad y del proyecto X. La terapia me ayudo a recuperar
el bienestar emocional.
EOF
cat > /tmp/memex-demo/receta.txt <<'EOF'
Tarta de manzana: manzana, harina, canela y azucar. Hornear 40 minutos.
EOF
```

En Windows usa una carpeta normal, por ejemplo `C:\memex-demo`.

## 2. Arrancar el servidor

```bash
node bin/memex.js init /tmp/memex-demo --no-model
node bin/memex.js serve --db /tmp/memex-demo/.memex/index.db
```

Debe aparecer:

```
✓ Memex escuchando en http://127.0.0.1:4747
  indice: /tmp/memex-demo/.memex/index.db
  Ctrl+C para detener
```

Abre <http://127.0.0.1:4747>. Comprueba:

- [ ] El indicador superior dice **en línea**.
- [ ] El pie muestra archivos, fragmentos, vectores y trails.
- [ ] Las pestanas **Buscar**, **Preguntar**, **Trails** e **Indexar** cambian
      de panel sin recargar.

## 3. Buscar

- [ ] Busca `ansiedad`: aparece `diario.md` con la palabra resaltada.
- [ ] Prueba `ansiedad proyecto` (AND) y marca **OR**: aparecen mas resultados.
- [ ] Prueba `"proyecto x"` y `informe*`.
- [ ] Cambia el modo a **lexico**, **semantico** e **hibrido**: el contador
      muestra el modo y los milisegundos.
- [ ] Cambia el limite a 10, 50 y 100: el numero de resultados se ajusta.
- [ ] Pulsa **Relacionados** en un resultado: aparece una lista de documentos
      afines con su puntuacion (o `Sin documentos relacionados.`).
- [ ] Una consulta sin resultados muestra `Sin resultados.` y no rompe la UI.
- [ ] Pulsa `/` fuera de un campo: el foco salta a la busqueda. Con el foco en
      una pestana, las flechas izquierda/derecha cambian de panel.

Con el proveedor `hash`, el modo semantico es **lexico**: no esperes que
encuentre sinonimos sin palabras en comun.

## 4. Preguntar

- [ ] Escribe `¿que conclusiones saque?` y pulsa **Preguntar**.
- [ ] Sin proveedor RAG configurado aparece el aviso de **modo offline** y las
      fuentes recuperadas con su ruta.
- [ ] Si configuras un proveedor (ver README), aparece la respuesta y el numero
      de fuentes citadas.

## 5. Trails

- [ ] En **Trails**, escribe `demo` y pulsa **Crear / abrir**.
- [ ] En **ruta o consulta** pon la ruta absoluta de `diario.md`, anade una nota
      y pulsa **Anadir nodo**.
- [ ] Anade `receta.txt`. El grafo SVG muestra dos nodos.
- [ ] **Descargar DOT** y **Descargar Markdown** generan archivos.
- [ ] **Copiar Mermaid** copia el diagrama (o muestra `Copia manual` si el
      navegador bloquea el portapapeles).
- [ ] Al volver a la pestana, **Refrescar** lista el trail con sus nodos.

## 6. Indexar desde la UI

- [ ] En **Indexar**, pega la ruta absoluta de una carpeta con textos.
- [ ] Pulsa **Indexar**: el log muestra escaneados, nuevos, actualizados, sin
      cambios, no indexables, eliminados y errores.
- [ ] El pie actualiza el numero de archivos y fragmentos.
- [ ] Borra un archivo de esa carpeta y vuelve a indexar: `eliminados` sube y el
      pie baja el numero de archivos.
- [ ] Pulsa **Indexar + vectores**: ademas calcula los pendientes; con ONNX la
      busqueda semantica encuentra lo recien indexado sin reiniciar.
- [ ] Prueba una ruta inexistente: el log muestra un error claro (no «0
      archivos»).

## 7. API (opcional, para scripts)

```bash
curl http://127.0.0.1:4747/api/health
curl http://127.0.0.1:4747/api/stats
curl 'http://127.0.0.1:4747/api/search?q=ansiedad&mode=lexical'
curl 'http://127.0.0.1:4747/api/search?q=ansiedad&limit=abc'   # 400, no 500
curl -X POST http://127.0.0.1:4747/api/save \
  -H 'content-type: application/json' \
  -d '{"url":"https://ejemplo.test/nota","title":"Nota","text":"calma y serenidad"}'
```

Comprueba que:

- [ ] `/api/health` devuelve `{ "ok": true }`.
- [ ] Un `limit` no numerico o un `mode` invalido devuelve **400** con un
      mensaje claro.
- [ ] Un JSON roto devuelve **400**, no un 500.
- [ ] `POST /api/index` con una carpeta inexistente devuelve **400**.
- [ ] Una peticion con `Origin: https://evil.example` devuelve **403**.
- [ ] La pagina guardada aparece al buscar `serenidad`.
- [ ] Las respuestas llevan `cache-control: no-store`.

## 8. Extension de navegador (opcional)

- [ ] Con el servidor arrancado, carga `extension/` como extension
      descomprimida en Chrome/Edge/Brave.
- [ ] Abre una pagina, pulsa el icono y **Guardar pagina actual**: el badge
      muestra `OK`.
- [ ] Busca una palabra de esa pagina en la UI: aparece con extension `.web`.
- [ ] Selecciona un texto y usa **Guardar seleccion** (o el menu contextual).

## 9. Cerrar y repetir

- [ ] `Ctrl+C` detiene el servidor; la UI pasa a **sin conexion** si se recarga.
- [ ] Al volver a arrancar, el indice y los trails siguen ahí.
- [ ] `node bin/memex.js clear --db ...` vacia el indice (la UI lo refleja al
      refrescar).
- [ ] Tras borrar un archivo del disco y reindexar, `memex search` ya no lo
      devuelve (poda).

## Problemas vistos en la UI

- **Sin conexion**: el servidor no esta arrancado o el puerto no es 4747.
- **No hay fragmentos**: indexa primero; `memex stats` debe mostrar archivos.
- **La busqueda semantica va vacia**: no hay vectores (`memex embed`) o el
  proveedor cambio de dimension (`memex embed --force`).
- **El puerto esta ocupado**: `memex serve --port 8080` y abre esa URL.
