# Extensión de navegador (Fase 8)

Guarda la página que estás viendo (o la selección) en tu índice local de Memex
Offline. La extensión solo habla con tu servidor en `127.0.0.1` / `localhost`:
no manda nada a internet.

## Instalación (Chrome, Edge, Brave u otro Chromium)

1. Arranca el servidor local:

   ```bash
   memex serve        # http://127.0.0.1:4747
   ```

2. Abre `chrome://extensions` y activa el **modo desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esta carpeta `extension/`.
4. El icono aparece en la barra. Ábrelo y usa **Guardar página actual** o
   **Guardar selección**. También tienes ambas opciones en el menú contextual
   (clic derecho sobre la página o sobre el texto seleccionado).

La URL del servidor se puede cambiar desde el propio popup (por defecto
`http://127.0.0.1:4747`, en cualquier puerto).

## Cómo funciona

- El popup captura `document.title`, `location.href` y el texto visible con
  `chrome.scripting.executeScript` (permiso `activeTab`, sin acceso permanente
  a los sitios).
- Envía `{ url, title, text, source: "extension" }` a `POST /api/save`.
- El servidor trocea el texto, calcula embeddings si están activos y lo inserta
  en el índice con extensión `.web` y `source: "extension"`.

Los documentos guardados aparecen igual que cualquier otro en `memex search`,
en la GUI y en `memex stats`.
