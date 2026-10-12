# Contribuir a Memex Offline

Gracias por pasarte. Este proyecto es pequeño y camina sobre una regla fuerte, así
que la primera sección es la única imprescindible: **no añadas dependencias**.

## Regla cero: sin dependencias

`package.json` no tiene `dependencies` ni `devDependencies` y eso no es un
accidente de juventud, es el diseño: el proyecto usa solo lo que trae Node
(`node:sqlite`, `node:http`, `node:zlib`, `node:test`…). Antes de proponer un
paquete, mira si se resuelve con la biblioteca estándar; casi siempre se puede
(documentación, plantillas y hasta la cobertura salen de `node --test`).

Si crees que una dependencia es inevitable, abre una issue explicando qué la hace
imprescindible. Fuera de eso, un PR que añada dependencias se cierra.

## Requisitos

- **Node >= 22.13** (por `node:sqlite`; ver `engines` en `package.json`).
- Opcional, para las funciones que dependen de binarios externos: `pdftotext` o
  `mutool`, `tesseract`, `whisper-cli`/`whisper` y `ffmpeg`. Si faltan, esa parte
  se omite y el resto funciona.

## Poner el proyecto en marcha

```bash
git clone https://github.com/jmarc9901/memex.git
cd memex
node bin/memex.js --help
```

## Comprobaciones antes de enviar un PR

```bash
npm run check      # sintaxis de todos los .js (sin dependencias, es el "lint")
npm test           # suite completa con node --test (~25 s)
npm run coverage   # opcional: cobertura de líneas/ramas/funciones
```

Los tres tienen que pasar. No hay linter ni formateador a propósito: el "lint" es
`node --check` (`scripts/check.js`). Mantén el estilo del código que ya está
(2 espacios, comillas dobles, punto y coma, ES modules).

## Cómo está organizado

```
bin/memex.js      entrada del CLI (comprueba la versión de Node antes de importar)
src/cli.js        parseo de argumentos y comandos
src/db.js         SQLite + FTS5: esquema, consultas, trails
src/indexer.js    indexado incremental y embeddings por lotes
src/extract.js    recorrido de carpetas, extracción y chunking
src/search.js     búsqueda híbrida (BM25 + coseno) y fusión RRF
src/rag.js        recuperación + generación opcional
test/             un fichero de tests por módulo, con node:test
```

Un módulo nuevo debería venir con su `test/<modulo>.test.js`. Y si toca el
ranking, con una mirada a `test/quality.test.js`, que es la red que mide
**aciertos** (precision@1 / recall@3) y no solo que la búsqueda devuelva algo.

## Convenciones

- **Idioma**: comentarios, documentación y mensajes de commit en español; el
  código (identificadores) en inglés. El README en inglés se mantiene sincronizado
  a mano, así que si cambias uno, cambia el otro.
- **Comentarios**: explican *por qué*, no *qué*. Los números mágicos
  (`SEMANTIC_MIN_SCORE`, `EXACT_LIMIT`, tope de 25 MB…) llevan la razón al lado.
- **Mensajes de commit**: un asunto corto e imperativo en español
  ("Corrige el umbral semántico…"), cuerpo en viñetas cuando haga falta explicar
  el porqué. Nada de `feat:`/`fix:`.
- **Errores**: se propagan; no los silencies con `catch {}` salvo que el contrato
  sea explícitamente "mejor seguir" (herramientas opcionales, ficheros ilegibles).
- **Degradación con gracia**: si falta un binario o una capacidad, se avisa y se
  sigue. Nunca se deja el índice a medias (mira `withTransaction` en `src/db.js`).

## Proceso

1. Abre una issue antes de trabajos grandes; así no duplicamos esfuerzo.
2. Rama corta (`fix/…`, `feat/…`) desde `main`.
3. Un PR por tema, con el contexto de CI en verde.
4. Los cambios en el comportamiento visible se anotan en `CHANGELOG.md`
   (sección "Sin publicar").

## Seguridad

Si encuentras un problema de seguridad, **no abras una issue pública**: sigue
[SECURITY.md](SECURITY.md).

Al contribuir aceptas el [código de conducta](CODE_OF_CONDUCT.md).
