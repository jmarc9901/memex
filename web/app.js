// Memex Offline - GUI web (vanilla JS, sin dependencias).
// Se sirve desde src/server.js y consume la API local en /api/*.

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convierte los marcadores [[termino]] del snippet en <mark> resaltados. */
function renderSnippet(text) {
  return escapeHtml(text).replace(/\[\[(.+?)\]\]/g, "<mark>$1</mark>");
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setBusy(form, busy) {
  for (const el of form.querySelectorAll("button, input")) el.disabled = busy;
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document
      .querySelectorAll(".panel")
      .forEach((p) => p.classList.toggle("active", p.id === `panel-${tab.dataset.tab}`));
    if (tab.dataset.tab === "trails") refreshTrails();
  });
}

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
    $("#footer-stats").textContent =
      `${s.files} archivos · ${s.chunks} fragmentos · ${s.embedded} con vector · ${s.trails} trails`;
  } catch {
    dot.className = "dot off";
    text.textContent = "sin conexión";
    $("#footer-stats").textContent = "servidor no disponible";
  }
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

function resultCard(row, i) {
  const badges = [];
  if (row.lexical_rank !== null && row.lexical_rank !== undefined) badges.push('<span class="badge lex">lex</span>');
  if (row.semantic_rank !== null && row.semantic_rank !== undefined) badges.push('<span class="badge sem">sem</span>');
  const score = Number(row.score);
  const scoreTxt = Number.isFinite(score) ? `<span class="badge">${score.toFixed(3)}</span>` : "";
  return `<article class="result">
    <div class="head">
      <span class="rank">${i + 1}.</span>
      <span class="name">${escapeHtml(row.name)}</span>
      <span class="badges">${badges.join("")}${scoreTxt}</span>
    </div>
    <div class="path">${escapeHtml(row.path)}</div>
    <div class="snippet">${renderSnippet(row.snippet)}</div>
  </article>`;
}

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
  const any = $("#search-any").checked ? "&any=1" : "";
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}${any}`);
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
            (c, i) => `<article class="result">
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
      (links ? `<h3 style="margin-top:12px">Enlaces</h3>${links}` : "");
  } catch {
    detail.innerHTML = '<p class="empty">Ese trail todavía no existe. Añade un nodo para crearlo.</p>';
    currentTrail = name;
    $("#trail-name").value = name;
  }
}

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

$("#index-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const path = $("#index-path").value.trim();
  const log = $("#index-log");
  if (!path) return;
  setBusy(form, true);
  log.textContent = "indexando…";
  try {
    const s = await api("/api/index", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    log.textContent =
      `raíz              : ${s.root}\n` +
      `archivos escaneados: ${s.scanned}\n` +
      `nuevos             : ${s.added}\n` +
      `actualizados       : ${s.updated}\n` +
      `sin cambios        : ${s.unchanged}\n` +
      `no indexables      : ${s.unsupported}\n` +
      `errores            : ${s.failed}`;
    await refreshStatus();
  } catch (err) {
    log.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
  } finally {
    setBusy(form, false);
  }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

refreshStatus();
refreshTrails();
setInterval(refreshStatus, 15000);
