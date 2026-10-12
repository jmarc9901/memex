// Memex Offline - calidad de la recuperacion (precision@1 / recall@3).
//
// El resto de tests comprueban que el ranking *funciona*; este comprueba que
// acierta. Se indexa un corpus con temas disjuntos y se evalua un conjunto de
// consultas etiquetadas (cada una con el documento que debe ganar). Con el
// proveedor por defecto (`hash`, que es lexico) la esperanza es alta en
// terminos que aparecen literalmente y nula en parafrasis sin palabras en
// comun: por eso el ultimo test fija esa frontera como caracterizacion.
//
// Baselines medidos (Node v26, proveedor hash dim 256, modo hybrid):
//   precision@1 = 8/8 = 1.00   recall@3 = 8/8 = 1.00
// (El corpus es sintetico y el proveedor `hash` es determinista, asi que el
// resultado se reproduce exacto.) El gate exige recall@3 perfecto y tolera un
// unico fallo de top-1: un cambio de ranking que empeore la calidad lo rompe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";
import { indexFolder } from "../src/indexer.js";
import { hybridSearch } from "../src/search.js";
import { createEmbedder } from "../src/embeddings.js";

const MIN_PRECISION_AT_1 = 0.875; // 7 de 8 (baseline medido: 8 de 8)
const MIN_RECALL_AT_3 = 1; // el documento correcto nunca debe perderse del top 3

/** Corpus de temas disjuntos. La clave es el nombre del archivo esperado. */
const CORPUS = {
  "tesis.md":
    "Conclusiones del proyecto de investigacion sobre ansiedad.\n\n" +
    "La terapia cognitivo conductual redujo los sintomas de ansiedad del grupo\n" +
    "experimental. El bienestar emocional mejoro de forma sostenida durante el\n" +
    "seguimiento de seis meses y las conclusiones se enviaron al comite.",
  "receta.txt":
    "Receta de tarta de manzana\n\nIngredientes: manzana, harina, canela, azucar.\n" +
    "Hornear la masa cuarenta minutos a temperatura media.",
  "factura.txt":
    "Factura del trimestre\n\nBase imponible, cuota de IVA y total a pagar al\n" +
    "cliente. El importe incluye el descuento por pronto pago.",
  "api.md":
    "Documentacion de la API\n\nEndpoints disponibles y esquema de autenticacion\n" +
    "con tokens de acceso. Cada peticion HTTP debe llevar la cabecera con el token.",
  "viaje.md":
    "Viaje a Lisboa\n\nReserva del hotel junto al centro, billete de tren y\n" +
    "alojamiento para cuatro noches en primavera.",
  "entrenamiento.md":
    "Rutina de fuerza\n\nSentadilla, press banca y peso muerto.\n" +
    "Tres series de ocho repeticiones con descanso de dos minutos.",
  "contrato.md":
    "Contrato de alquiler\n\nClausulas de duracion y obligaciones del arrendador y\n" +
    "del arrendatario. El alquiler se actualiza cada año.",
  "huerto.md":
    "Huerto de verano\n\nPlantar tomates, riego por goteo y abono organico.\n" +
    "La temporada empieza en abril.",
};

/** Consultas etiquetadas: [consulta, documento esperado en el top-1]. */
const QUERIES = [
  ["ansiedad", "tesis.md"],
  ["receta de tarta de manzana", "receta.txt"],
  ["IVA trimestre", "factura.txt"],
  ["endpoints autenticacion", "api.md"],
  ["hotel Lisboa", "viaje.md"],
  ["sentadilla press banca", "entrenamiento.md"],
  ["clausulas arrendatario", "contrato.md"],
  ["riego abono tomates", "huerto.md"],
];

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "memex-quality-"));
  for (const [name, text] of Object.entries(CORPUS)) {
    writeFileSync(join(root, name), text + "\n");
  }
  return root;
}

/** Indexa el corpus y devuelve {root, db, embedder} (hash explicito). */
function setup() {
  const root = makeCorpus();
  const db = openDatabase(join(root, ".memex", "index.db"));
  const embedder = createEmbedder({ embed_provider: "hash", embed_dim: 256 });
  indexFolder(db, root, { embedder });
  return { root, db, embedder };
}

/** Evalua las consultas y devuelve las metricas con el detalle de los fallos. */
function evaluate(db, embedder) {
  const details = [];
  let top1 = 0;
  let top3 = 0;
  for (const [query, expected] of QUERIES) {
    const hits = hybridSearch(db, query, { mode: "hybrid", limit: 3, embedder });
    const names = hits.map((h) => h.name);
    if (names[0] === expected) top1 += 1;
    if (names.includes(expected)) top3 += 1;
    details.push(`"${query}" -> ${names.join(", ") || "(sin resultados)"} (esperado ${expected})`);
  }
  return {
    precisionAt1: top1 / QUERIES.length,
    recallAt3: top3 / QUERIES.length,
    details,
  };
}

test("la busqueda hibrida acierta el documento correcto (precision@1 y recall@3)", (t) => {
  const { root, db, embedder } = setup();
  try {
    const m = evaluate(db, embedder);
    t.diagnostic(`precision@1 = ${m.precisionAt1.toFixed(2)} · recall@3 = ${m.recallAt3.toFixed(2)}`);
    for (const line of m.details) t.diagnostic(line);

    assert.ok(
      m.recallAt3 >= MIN_RECALL_AT_3,
      `recall@3 = ${m.recallAt3.toFixed(2)} < ${MIN_RECALL_AT_3}:\n${m.details.join("\n")}`
    );
    assert.ok(
      m.precisionAt1 >= MIN_PRECISION_AT_1,
      `precision@1 = ${m.precisionAt1.toFixed(2)} < ${MIN_PRECISION_AT_1}:\n${m.details.join("\n")}`
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el modo semantico ordena el documento afin primero", () => {
  const { root, db, embedder } = setup();
  try {
    const hits = hybridSearch(db, "tarta de manzana con canela", { mode: "semantic", limit: 8, embedder });
    const names = hits.map((h) => h.name);
    assert.equal(
      names[0],
      "receta.txt",
      `esperaba receta.txt primero, obtuve ${names.join(", ") || "(sin resultados)"}`
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("caracterizacion: sin solapamiento lexico el hibrido devuelve hits sin evidencia lexica", () => {
  const { root, db, embedder } = setup();
  try {
    // Frontera de la Ruta 1: con embeddings lexicos (feature hashing), una
    // consulta cuyos terminos no aparecen en ningun documento no debe producir
    // coincidencias lexicas, pero el modo hibrido si devuelve una lista (la
    // rellena la rama de embeddings con ruido de trigramas). De ahi que sus
    // puntuaciones no se puedan leer como relevancia real: es la limitacion que
    // documenta el README y la razon de ofrecer ONNX.
    const query = "nervioso preocupado insomnio";
    const lexical = hybridSearch(db, query, { mode: "lexical", limit: 8 });
    assert.equal(lexical.length, 0, "con AND y terminos ausentes, el modo lexical debe quedar vacio");

    const hybrid = hybridSearch(db, query, { mode: "hybrid", limit: 8, embedder });
    assert.ok(hybrid.length > 0, "el modo hibrido rellena desde la rama de embeddings");
    assert.ok(
      hybrid.every((h) => h.lexical_rank === null),
      "ningun hit puede traer evidencia lexica: son ruido de trigramas del proveedor hash"
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
