// Memex Offline - GUI web (vanilla JS, sin dependencias).
// Se sirve desde src/server.js y consume la API local en /api/*.
import {
  escapeHtml,
  renderSnippet,
  resultCard,
  trailSvg,
  formatStats,
  formatIndexSummary,
} from "./lib.js";

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setBusy(form, busy) {
  for (const el of form.querySelectorAll("button, input, select")) el.disabled = busy;
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function activateTab(tab) {
  for (const other of document.querySelectorAll(".tab")) {
    const active = other === tab;
    other.classList.toggle("active", active);
    other.setAttribute("aria-selected", String(active));
    other.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll(".panel")) {
    const active = panel.id === `panel-${tab.dataset.tab}`;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", String(!active));
  }
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    activateTab(tab);
    if (tab.dataset.tab === "trails") refreshTrails();
  });
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".tab")];
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    activateTab(next);
    next.focus();
    if (next.dataset.tab === "trails") refreshTrails();
  });
}

// Atajo: "/" enfoca la busqueda (salvo que ya se este escribiendo).
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.target.closest("input, textarea, select")) return;
  event.preventDefault();
  activateTab(document.querySelector('.tab[data-tab="search"]'));
  $("#search-input").focus();
});

// ---------------------------------------------------------------------------
// Estado / estadísticas
// ---------------------------------------------------------------------------

async function refreshStatus() {
  const dot = $("#status-dot");
  const text = $("#status-text");
  try {
    const s = await api("/api/stats");
    dot.className = "dot ok";
    text.textContent = "en línea";
    $("#footer-stats").textContent = formatStats(s);
  } catch {
    dot.className = "dot off";
    text.textContent = "sin conexión";
    $("#footer-stats").textContent = "servidor no disponible";
  }
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const query = $("#search-input").value.trim();
  const meta = $("#search-meta");
  const results = $("#search-results");
  if (!query) return;

  setBusy(form, true);
  meta.textContent = "buscando…";
  results.innerHTML = "";
  const mode = $("#search-mode").value;
  const limit = $("#search-limit").value;
  const any = $("#search-any").checked ? "&any=1" : "";
  try {
    const data = await api(
      `/api/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=${limit}${any}`
    );
    meta.textContent = `${data.results.length} resultado(s) en ${data.took_ms} ms · modo ${data.mode}`;
    results.innerHTML = data.results.length
      ? data.results.map(resultCard).join("")
      : '<p class="empty">Sin resultados.</p>';
  } catch (err) {
    meta.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
  } finally {
    setBusy(form, false);
  }
});

/** "Relacionados": pide /api/relate para la ruta de la tarjeta pulsada. */
$("#search-results").addEventListener("click", async (event) => {
  const button = event.target.closest("button.relate");
  if (!button) return;
  const card = button.closest(".result");
  const ref = button.dataset.ref;
  if (!ref) return;

  button.disabled = true;
  let box = card.querySelector(".related");
  if (!box) {
    box = document.createElement("div");
    box.className = "related";
    card.appendChild(box);
  }
  try {
    const data = await api(`/api/relate?ref=${encodeURIComponent(ref)}&limit=5`);
    box.innerHTML = data.results.length
      ? "<h4>Documentos relacionados</h4>" +
        data.results
          .map(
            (r) =>
              `<div class="related-item"><span class="badge">${Number(r.score).toFixed(3)}</span> ` +
              `<span class="name">${escapeHtml(r.name)}</span> ` +
              `<span class="path">${escapeHtml(r.path)}</span></div>`
          )
          .join("")
      : '<p class="empty">Sin documentos relacionados.</p>';
  } catch (err) {
    box.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Preguntar (RAG)
// ---------------------------------------------------------------------------

$("#ask-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const question = $("#ask-input").value.trim();
  if (!question) return;

  const meta = $("#ask-meta");
  const answer = $("#ask-answer");
  const context = $("#ask-context");
  setBusy(form, true);
  meta.textContent = "pensando…";
  answer.classList.remove("visible");
  context.innerHTML = "";

  try {
    const data = await api("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (data.answer) {
      answer.textContent = data.answer;
      answer.classList.add("visible");
      meta.textContent = `respuesta de ${data.model ?? "el modelo"} · ${data.context.length} fuentes`;
    } else if (data.error) {
      meta.innerHTML = `<span class="error">No se pudo generar la respuesta (${escapeHtml(data.error)}). Mostrando fuentes locales.</span>`;
    } else {
      meta.textContent = "Modo offline: sin proveedor RAG configurado. Estas son las fuentes recuperadas.";
    }
    context.innerHTML = data.context.length
      ? data.context
          .map(
            (c) => `<article class="result">
              <div class="head"><span class="rank">[${c.n}]</span>
              <span class="name">${escapeHtml(c.name)}</span></div>
              <div class="path">${escapeHtml(c.path)}</div>
              <div class="snippet">${renderSnippet(c.text)}</div>
            </article>`
          )
          .join("")
      : '<p class="empty">No hay fragmentos en el índice.</p>';
  } catch (err) {
    meta.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
  } finally {
    setBusy(form, false);
  }
});

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

let currentTrail = null;

async function refreshTrails() {
  const list = $("#trail-list");
  try {
    const data = await api("/api/trails");
    list.innerHTML = data.trails.length
      ? data.trails
          .map(
            (t) => `<li data-trail="${escapeHtml(t.name)}">
              <div>${escapeHtml(t.name)}</div>
              <div class="counts">${t.nodes} nodos · ${t.edges} enlaces</div>
            </li>`
          )
          .join("")
      : '<li class="empty">Aún no hay trails.</li>';
    for (const li of list.querySelectorAll("li[data-trail]")) {
      li.addEventListener("click", () => openTrail(li.dataset.trail));
    }
  } catch (err) {
    list.innerHTML = `<li class="error">${escapeHtml(err.message)}</li>`;
  }
}

async function openTrail(name) {
  const detail = $("#trail-detail");
  $("#trail-detail-title").textContent = `Detalle · ${name}`;
  try {
    const g = await api(`/api/trails/${encodeURIComponent(name)}`);
    currentTrail = name;
    $("#trail-name").value = name;
    const nodes = g.nodes
      .map(
        (n) =>
          `<li>${escapeHtml(n.label)} <span class="path">${escapeHtml(n.path)}</span>${
            n.note ? ` <em>${escapeHtml(n.note)}</em>` : ""
          }</li>`
      )
      .join("");
    const links = g.links
      .map((l) => `<div class="edge">${escapeHtml(String(l.source))} → ${escapeHtml(String(l.target))}${l.label ? ` (${escapeHtml(l.label)})` : ""}</div>`)
      .join("");
    detail.innerHTML =
      (nodes ? `<ol>${nodes}</ol>` : '<p class="empty">Trail vacío.</p>') +
      (links ? `<h3 class="edges-title">Enlaces</h3>${links}` : "");
    $("#trail-graph").innerHTML = trailSvg(g);
  } catch {
    detail.innerHTML = '<p class="empty">Ese trail todavía no existe. Añade un nodo para crearlo.</p>';
    $("#trail-graph").innerHTML = "";
    currentTrail = name;
    $("#trail-name").value = name;
  }
}

async function fetchTrailFormat(format) {
  if (!currentTrail) return null;
  const res = await fetch(`/api/trails/${encodeURIComponent(currentTrail)}?format=${format}`);
  return res.ok ? res.text() : null;
}

async function downloadTrail(format, ext) {
  const text = await fetchTrailFormat(format);
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentTrail}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

$("#trail-dot").addEventListener("click", () => downloadTrail("dot", "dot"));
$("#trail-md").addEventListener("click", () => downloadTrail("md", "md"));
$("#trail-mermaid").addEventListener("click", async (event) => {
  const text = await fetchTrailFormat("mermaid");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    event.currentTarget.textContent = "Copiado ✓";
    setTimeout(() => (event.currentTarget.textContent = "Copiar Mermaid"), 1500);
  } catch {
    event.currentTarget.textContent = "Copia manual";
  }
});

$("#trail-refresh").addEventListener("click", refreshTrails);

$("#trail-create").addEventListener("click", () => {
  const name = $("#trail-name").value.trim();
  if (name) openTrail(name);
});

$("#trail-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#trail-name").value.trim() || currentTrail;
  const ref = $("#trail-ref").value.trim();
  if (!name || !ref) return;
  setBusy(form, true);
  try {
    const res = await api(`/api/trails/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, note: $("#trail-note").value.trim() || undefined }),
    });
    if (!res.ok) throw new Error(res.reason || "no se pudo añadir el nodo");
    $("#trail-ref").value = "";
    $("#trail-note").value = "";
    await openTrail(name);
    await refreshTrails();
    await refreshStatus();
  } catch (err) {
    $("#trail-detail").innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  } finally {
    setBusy(form, false);
  }
});

// ---------------------------------------------------------------------------
// Indexar
// ---------------------------------------------------------------------------

async function runIndex(endpoint, label) {
  const path = $("#index-path").value.trim();
  const log = $("#index-log");
  if (!path) return;
  const form = $("#index-form");
  setBusy(form, true);
  log.textContent = `${label}…`;
  try {
    const summary = await api(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    // `/api/index` devuelve el resumen en la raiz; `/api/embed` anida el
    // resumen de texto en `text` y deja `embedded` arriba.
    const main = summary.text ?? summary;
    log.textContent = formatIndexSummary({
      ...main,
      embedded: summary.embedded ?? main.embedded,
    });
    await refreshStatus();
  } catch (err) {
    log.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
  } finally {
    setBusy(form, false);
  }
}

$("#index-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runIndex("/api/index", "indexando");
});

$("#index-embed").addEventListener("click", () => {
  runIndex("/api/embed", "indexando y calculando vectores");
});

// ---------------------------------------------------------------------------
// Herramientas opcionales (/api/tools)
// ---------------------------------------------------------------------------

async function loadTools() {
  const box = $("#tools-list");
  const summary = $("#tools-summary");
  try {
    const data = await api("/api/tools");
    const cap = data.capabilities;
    summary.textContent =
      `PDF ${cap.pdf ? "si" : "no"} · OCR ${cap.ocr ? "si" : "no"} · transcripción ${cap.transcription ? "si" : "no"}` +
      ` · embeddings ${data.config.embed_provider} (dim ${data.config.embed_dim})` +
      ` · RAG ${data.config.rag_enabled ? "activado" : "desactivado"}`;
    box.innerHTML = data.tools
      .map(
        (t) => `<div class="tool" title="${escapeHtml(t.purpose)}${t.env ? ` · ${escapeHtml(t.env)}` : ""}">
          <span class="${t.available ? "ok" : "off"}">${t.available ? "✓" : "✗"}</span>
          <span>${escapeHtml(t.name)}</span>
        </div>`
      )
      .join("");
  } catch (err) {
    box.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

activateTab(document.querySelector('.tab[data-tab="search"]'));
refreshStatus();
refreshTrails();
loadTools();
setInterval(refreshStatus, 15000);
