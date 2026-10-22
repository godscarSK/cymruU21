// Revisa data/players.json y cuenta qué skills trae realmente cada jugador.
// Uso (en la carpeta donde está la carpeta data):   node check-players.mjs
// Opcional: node check-players.mjs ruta/al/archivo.json

import { readFile } from "node:fs/promises";

const file = process.argv[2] || "data/players.json";
const j = JSON.parse(await readFile(file, "utf8"));
const api = j.api || {};
const pids = Object.keys(api);
const rows = j.rows || [];

console.log(`Archivo: ${file}`);
console.log(`Generado: ${j.generatedAt || "(sin fecha)"}`);
console.log(`Jugadores en rows: ${rows.length}. Con respuesta de la API: ${pids.length}.`);
console.log(`rows con skills de la hoja (columnas RES, RAP…): ${rows.filter(r => r.skills && Object.keys(r.skills).length).length}`);

const KEYS = ["stamina", "pace", "technique", "passing", "keeper", "playmaking", "defending", "striker"];
const stat = Object.fromEntries(KEYS.map(k => [k, { "aparece": 0, "con número": 0, "vacía (null)": 0 }]));
const seen = new Map();
const without = [];
let complete = 0;

for (const pid of pids) {
  const s = api[pid]?.info?.skills || {};
  for (const k of Object.keys(s)) seen.set(k, (seen.get(k) || 0) + 1);
  let numeric = 0;
  for (const k of KEYS) {
    if (!(k in s)) continue;
    stat[k]["aparece"]++;
    if (typeof s[k] === "number") { stat[k]["con número"]++; numeric++; }
    else if (s[k] === null) stat[k]["vacía (null)"]++;
  }
  if (numeric === KEYS.length) complete++;
  else if (without.length < 3) without.push({ pid, skills: s });
}

console.log(`\nJugadores con las 8 skills como número: ${complete} de ${pids.length}`);
console.table(stat);
console.log("Claves que aparecen dentro de info.skills:");
console.log("  " + ([...seen].map(([k, n]) => `${k} (${n})`).join(", ") || "ninguna"));
if (without.length) {
  console.log("\nEjemplos de jugadores sin las 8 skills:");
  for (const e of without) console.log(`  ${e.pid}: ${JSON.stringify(e.skills)}`);
}
