# Política de seguridad

## Modelo de amenazas

Memex Offline es una herramienta **local y mono-usuario**. Todo ocurre en tu
máquina y el diseño asume que el usuario del sistema es de confianza. Lo que sí
está endurecido:

- **`serve` escucha solo en loopback** (`127.0.0.1`/`::1`). Un `--host` fuera de
  loopback se rechaza al arrancar salvo que pases `--allow-remote`, porque la API
  **no tiene autenticación**: quien alcance el puerto puede buscar, indexar y
  guardar documentos en tu índice.
- **La API rechaza orígenes no autorizados.** Las peticiones con cabecera
  `Origin` que no sea `localhost`/`127.0.0.1`/`::1` ni una extensión de navegador
  (`chrome-extension://`, `moz-extension://`) reciben `403` y nunca se refleja su
  CORS. Esto impide que una web que visites lea tu índice con `fetch`.
- **La GUI lleva CSP** sin recursos externos ni scripts inline, `nosniff`,
  `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`.
- **El servidor de ficheros está confinado a `web/`** (resuelto con
  `path.relative`, no con un prefijo de cadena).
- **Sin telemetría.** El único tráfico de red es hacia el proveedor RAG que
  configures (opcional) y la descarga del modelo en `memex init`.

## Límites conocidos (no son vulnerabilidades)

- La API no tiene autenticación **por diseño**; para eso existe el loopback
  obligatorio. Si activas `--allow-remote`, es tu decisión y tu red.
- Cualquier proceso local que ejecute el mismo usuario puede leer el índice y la
  configuración (incluida `rag.api_key` si la guardas en el fichero de config).
  Prefiere variables de entorno (`MEMEX_RAG_API_KEY`) a escribir la clave.
- El índice se guarda sin cifrar (SQLite). No hay gestión de secretos.
- Las herramientas externas opcionales (`pdftotext`, `tesseract`, `whisper`,
  `ffmpeg`) se ejecutan con la ruta del fichero indexado como argumento, sin
  `shell`, así que no hay inyección de comandos; si una de ellas tiene una
  vulnerabilidad propia, queda fuera del alcance del proyecto.

## Versiones soportadas

Solo la última versión publicada (hoy `0.3.x`) recibe correcciones de seguridad.

## Cómo reportar

- Usa **GitHub Security Advisories** del repositorio
  (<https://github.com/jmarc9901/memex/security/advisories/new>) para reportar en
  privado.
- Nos comprometemos a acusar recibo en unos días y a coordinar la divulgación
  contigo antes de publicar nada.
- Si el problema no tiene impacto de seguridad real (por ejemplo, un error de
  comportamiento), usa una issue normal.
