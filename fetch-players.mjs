// Genera data/players.json: lee la hoja de Google y consulta la API de Sokker por cada PID.
// Uso (Node 18 o superior, sin instalar nada):   node fetch-players.mjs
// Después sube data/players.json al repositorio. La página lo usa sola.

import { mkdir, writeFile } from "node:fs/promises";

const SHEET_ID = "1kBi5kAlC7dlmQ3jPi5D1SbtIkNME8KI5SxIG0XRIMWE";
const SHEET_TAB = "";                         // vacío = primera pestaña
const API_BASE = "https://sokker.org/api";
const CONCURRENCY = 3;
const DELAY_MS = 150;                         // pausa entre llamadas, para no saturar el sitio

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Mismos alias de skills que usa index.html para columnas extra de la hoja.
const SKILL_ALIASES = {
  stamina:   ["stamina", "stam", "res", "resistencia"],
  pace:      ["pace", "rap", "rapidez"],
  technique: ["technique", "tech", "tec", "téc", "tecnica", "técnica"],
  passing:   ["passing", "pass", "pas", "pase"],
  keeper:    ["keeper", "goalkeeping", "gk", "por", "portero"],
  defender:  ["defender", "defending", "def", "defensa"],
  playmaker: ["playmaker", "playmaking", "pm", "cre", "creacion", "creación"],
  striker:   ["striker", "scoring", "str", "ano", "anotacion", "anotación"]
};

function rowsToPlayers(rows) {
  const h = rows.findIndex(r => r.some(c => c.trim().toUpperCase() === "PID"));
  if (h < 0) throw new Error("No encontré la columna PID en la hoja.");
  const head = rows[h].map(c => c.trim().toLowerCase());
  const iPid = head.indexOf("pid");
  const iName = ["player", "jugador", "nombre"].map(k => head.indexOf(k)).find(i => i >= 0) ?? -1;
  const iN = head.indexOf("#");
  const skillCols = {};
  for (const [key, names] of Object.entries(SKILL_ALIASES)) {
    const i = head.findIndex(c => names.includes(c));
    if (i >= 0) skillCols[key] = i;
  }
  const seen = new Set(), out = [];
  for (const r of rows.slice(h + 1)) {
    const pid = (r[iPid] || "").trim();
    if (!/^\d+$/.test(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const skills = {};
    for (const [k, i] of Object.entries(skillCols)) {
      const v = (r[i] || "").trim().replace(",", ".");
      if (v !== "" && Number.isFinite(Number(v))) skills[k] = Number(v);
    }
    out.push({ n: Number(r[iN]) || out.length + 1, name: iName >= 0 ? (r[iName] || "").trim() : "", pid, skills });
  }
  if (!out.length) throw new Error("La hoja no tiene ningún PID numérico.");
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
if (SHEET_TAB) url += "&sheet=" + encodeURIComponent(SHEET_TAB);

const sheetResp = await fetch(url);
if (!sheetResp.ok) throw new Error(`No pude leer la hoja (HTTP ${sheetResp.status}). ¿Está compartida con el enlace?`);
const rows = rowsToPlayers(parseCSV(await sheetResp.text()));
console.log(`Hoja leída: ${rows.length} jugadores.`);

// Inicio de sesión opcional (para ver las skills de tus propios jugadores y de los que están en venta).
// Define SOKKER_USER y SOKKER_PASS en el entorno; la contraseña no se escribe en ningún archivo.
const LOGIN_FIELDS = { username: "login", password: "password" };   // deben coincidir con LoginRequest en apidoc.html
const LOGIN_EXTRA = { remember: false };                            // otros campos de LoginRequest
let cookie = "";
if (process.env.SOKKER_USER && process.env.SOKKER_PASS) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      [LOGIN_FIELDS.username]: process.env.SOKKER_USER,
      [LOGIN_FIELDS.password]: process.env.SOKKER_PASS,
      ...LOGIN_EXTRA
    })
  });
  if (!r.ok) throw new Error(`Sokker no aceptó el login (HTTP ${r.status}). Revisa usuario, contraseña y LOGIN_FIELDS.`);
  cookie = r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  if (!cookie) console.warn("Login aceptado, pero Sokker no envió cookie de sesión: se seguirá sin sesión.");
  else console.log("Sesión iniciada en Sokker.");
}

const api = {};
let next = 0, done = 0, failed = 0;
async function worker() {
  while (next < rows.length) {
    const r = rows[next++];
    try {
      const resp = await fetch(`${API_BASE}/player/${r.pid}`, {
        headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) }
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      api[r.pid] = await resp.json();
    } catch (e) {
      failed++;
      console.warn(`  PID ${r.pid}: ${e.message}`);
    }
    done++;
    if (done % 20 === 0 || done === rows.length) console.log(`  ${done} de ${rows.length}`);
    await sleep(DELAY_MS);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

await mkdir("data", { recursive: true });
await writeFile("data/players.json", JSON.stringify({ generatedAt: new Date().toISOString(), rows, api }));
console.log(`Listo: data/players.json (${rows.length - failed} jugadores con datos, ${failed} con error).`);
