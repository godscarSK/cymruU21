// Genera data/players.json: lee la hoja de Google y consulta la API de Sokker por cada PID.
// Uso (Node 18 o superior, sin instalar nada):   node fetch-players.mjs
// Después sube la carpeta data (players.json y players.prev.json) al repositorio. La página lo usa sola.

import { mkdir, writeFile, readFile, copyFile, stat } from "node:fs/promises";

const SHEET_ID = "1kBi5kAlC7dlmQ3jPi5D1SbtIkNME8KI5SxIG0XRIMWE";
const SHEET_TAB = "";                         // vacío = primera pestaña
const API_BASE = "https://sokker.org/api";
const CONCURRENCY = 3;
const DELAY_MS = 150;                         // pausa entre llamadas, para no saturar el sitio

// Respaldo semanal para comparar skills. La «semana» empieza el jueves a las 00:00 (hora de este computador).
// El respaldo (data/players.prev.json) es el players.json de la semana anterior: se renueva solo la primera
// vez que se ejecuta el script cada jueves y se conserva sin cambios hasta el miércoles siguiente.
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7));   // 4 = jueves
  return d;
}
async function rotateBackup(dir = "data", now = new Date()) {
  const cur = `${dir}/players.json`, prev = `${dir}/players.prev.json`;
  let when;
  try {
    const j = JSON.parse(await readFile(cur, "utf8"));
    when = j.generatedAt ? new Date(j.generatedAt) : (await stat(cur)).mtime;
  } catch { return "no hay un players.json anterior: todavía no hay nada que comparar"; }
  if (!(when < weekStart(now))) return "el players.json actual es de esta misma semana: se conserva el respaldo anterior";
  await copyFile(cur, prev);
  return "respaldo renovado: la semana anterior quedó en data/players.prev.json";
}

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
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300).trim();
    throw new Error(`Sokker no aceptó el login (HTTP ${r.status}). Revisa usuario, contraseña, LOGIN_FIELDS y LOGIN_EXTRA.\nRespuesta de Sokker: ${detail || "(vacía)"}`);
  }
  cookie = r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  if (!cookie) console.warn("Login aceptado, pero Sokker no envió cookie de sesión: se seguirá sin sesión.");
  else {
    const me = await fetch(`${API_BASE}/current`, { headers: { Accept: "application/json", Cookie: cookie } });
    console.log(me.ok
      ? "Sesión iniciada y verificada en Sokker (/current responde 200)."
      : `Advertencia: el login fue aceptado pero /current respondió ${me.status}; la sesión no se está aplicando.`);
  }
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

// Equipos sin dueño («bot»): GET /team/{id}/owner responde 404 cuando no hay dueño.
const teams = {};
const teamIds = [...new Set(Object.values(api).map(a => a?.info?.team?.id).filter(x => x != null))];
console.log(`Revisando el dueño de ${teamIds.length} equipos…`);
let tn = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (tn < teamIds.length) {
    const id = teamIds[tn++];
    try {
      const r = await fetch(`${API_BASE}/team/${id}/owner`, { headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } });
      if (r.status === 404) teams[id] = { bot: true };
      else if (r.ok) teams[id] = { bot: false };
      else console.warn(`  Equipo ${id}: HTTP ${r.status}`);
    } catch (e) { console.warn(`  Equipo ${id}: ${e.message}`); }
    await sleep(DELAY_MS);
  }
}));
console.log(`Equipos bot: ${Object.values(teams).filter(t => t.bot).length} de ${teamIds.length}.`);

await mkdir("data", { recursive: true });
console.log("Respaldo semanal: " + await rotateBackup());
await writeFile("data/players.json", JSON.stringify({ generatedAt: new Date().toISOString(), rows, api, teams }));
console.log(`Listo: data/players.json (${rows.length - failed} jugadores con datos, ${failed} con error).`);

// Diagnóstico: la API siempre entrega estas 4 skills; las demás solo para jugadores propios o en venta.
const PUBLIC_SKILLS = new Set(["form", "tacticalDiscipline", "teamwork", "experience"]);
const withSkills = Object.values(api).filter(a => Object.keys(a?.info?.skills || {}).some(k => !PUBLIC_SKILLS.has(k)));
console.log(`Jugadores con skills completas en la respuesta de la API: ${withSkills.length} de ${Object.keys(api).length}.`);
if (!withSkills.length) console.log("Ninguno. Es lo esperado si ningún PID de la hoja es de tu equipo ni está en venta.");
