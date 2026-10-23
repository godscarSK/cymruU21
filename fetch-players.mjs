// Genera data/players.enc.json (cifrado): lee la hoja de Google y consulta la API de Sokker por cada PID.
// Uso (Node 18 o superior, sin instalar nada):   node fetch-players.mjs
// Después sube data/players.enc.json y data/players.prev.enc.json al repositorio. La página los descifra con tu contraseña.

import { mkdir, writeFile, readFile, copyFile, stat, rm } from "node:fs/promises";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createInterface } from "node:readline";

const SHEET_ID = "1kBi5kAlC7dlmQ3jPi5D1SbtIkNME8KI5SxIG0XRIMWE";
const SHEET_TAB = "";                         // vacío = primera pestaña
const API_BASE = "https://sokker.org/api";
const CONCURRENCY = 3;
const DELAY_MS = 150;                         // pausa entre llamadas, para no saturar el sitio

// ── CIFRADO Y RESPALDO ─────────────────────────────────────────────────────────────────────────
// Los datos se guardan cifrados (AES-256-GCM, clave derivada de tu contraseña con PBKDF2). La página
// los descifra en el navegador al escribir la contraseña. La contraseña no se escribe en ningún archivo.
const KDF_ITER = 250000;
const norm = pw => String(pw).normalize("NFC");
function encryptJSON(obj, password) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(norm(password), salt, KDF_ITER, 32, "sha256");
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(obj)))), c.final(), c.getAuthTag()]);
  return { v: 1, z: 1, iter: KDF_ITER, generatedAt: obj.generatedAt, salt: salt.toString("base64"), iv: iv.toString("base64"), data: ct.toString("base64") };
}
function decryptJSON(env, password) {
  const key = pbkdf2Sync(norm(password), Buffer.from(env.salt, "base64"), env.iter, 32, "sha256");
  const raw = Buffer.from(env.data, "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  let buf = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
  if (env.z) buf = gunzipSync(buf);
  return JSON.parse(buf.toString("utf8"));
}
async function opensWith(file, password) {
  try { decryptJSON(JSON.parse(await readFile(file, "utf8")), password); return true; } catch { return false; }
}

// Respaldo semanal para comparar skills. La «semana» empieza el jueves a las 00:00 (hora de este computador).
// El respaldo (data/players.prev.enc.json) es el archivo de la semana anterior: se renueva solo la primera
// vez que se ejecuta el script cada jueves y se conserva sin cambios hasta el miércoles siguiente.
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7));   // 4 = jueves
  return d;
}
async function rotateBackup(dir = "data", now = new Date(), password = "", unreadable = false) {
  const enc = `${dir}/players.enc.json`, plain = `${dir}/players.json`, prev = `${dir}/players.prev.enc.json`;
  let when, isEnc = true, obj = null;
  try {
    const j = JSON.parse(await readFile(enc, "utf8"));
    when = j.generatedAt ? new Date(j.generatedAt) : (await stat(enc)).mtime;
  } catch {
    try {
      obj = JSON.parse(await readFile(plain, "utf8")); isEnc = false;
      when = obj.generatedAt ? new Date(obj.generatedAt) : (await stat(plain)).mtime;
    } catch { return "no hay un archivo anterior: todavía no hay nada que comparar"; }
  }
  if (!(when < weekStart(now))) return "el archivo actual es de esta misma semana: se conserva el respaldo anterior";
  if (isEnc && unreadable) { await rm(prev, { force: true }); return "la contraseña cambió: el archivo anterior no se puede leer, así que no hay respaldo esta semana"; }
  if (isEnc) await copyFile(enc, prev);
  else await writeFile(prev, JSON.stringify(encryptJSON(obj, password)));
  return "respaldo renovado: la semana anterior quedó en data/players.prev.enc.json";
}
// ── FIN CIFRADO Y RESPALDO ─────────────────────────────────────────────────────────────────────

function askHidden(q) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl._writeToOutput;
    rl._writeToOutput = t => { if (t.startsWith(q)) w.call(rl, t); };
    rl.question(q, a => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}
async function getSitePassword() {
  let pw = process.env.SITE_PASSWORD || await askHidden("Contraseña de la página (la que pedirá el navegador): ");
  if (pw.length < 8) throw new Error("La contraseña de la página debe tener al menos 8 caracteres (mejor una larga).");
  const existing = "data/players.enc.json";
  let unreadable = false;
  if (await readFile(existing).then(() => true, () => false) && !(await opensWith(existing, pw))) {
    console.log("Esta contraseña no abre el archivo cifrado anterior (¿la cambiaste o hay un error de tipeo?).");
    if (process.env.SITE_PASSWORD || (await askHidden("Escríbela otra vez para confirmar que es la nueva contraseña: ")) !== pw)
      throw new Error("No se confirmó la contraseña nueva. Vuelve a ejecutar el script.");
    unreadable = true;
  }
  return { pw, unreadable };
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

// Contraseña de la página: se pide primero, para no descubrir un error de tipeo al final.
const { pw: SITE_PW, unreadable: PW_CHANGED } = await getSitePassword();

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
console.log("Respaldo semanal: " + await rotateBackup("data", new Date(), SITE_PW, PW_CHANGED));
await writeFile("data/players.enc.json", JSON.stringify(encryptJSON({ generatedAt: new Date().toISOString(), rows, api, teams }, SITE_PW)));
console.log(`Listo: data/players.enc.json, cifrado (${rows.length - failed} jugadores con datos, ${failed} con error).`);
for (const f of ["data/players.json", "data/players.prev.json"]) {
  if (await readFile(f).then(() => true, () => false))
    console.log(`AVISO: ${f} está SIN CIFRAR y ya no se usa. Bórralo de tu computador y del repositorio de GitHub.`);
}

// Diagnóstico: la API siempre entrega estas 4 skills; las demás solo para jugadores propios o en venta.
const PUBLIC_SKILLS = new Set(["form", "tacticalDiscipline", "teamwork", "experience"]);
const withSkills = Object.values(api).filter(a => Object.keys(a?.info?.skills || {}).some(k => !PUBLIC_SKILLS.has(k)));
console.log(`Jugadores con skills completas en la respuesta de la API: ${withSkills.length} de ${Object.keys(api).length}.`);
if (!withSkills.length) console.log("Ninguno. Es lo esperado si ningún PID de la hoja es de tu equipo ni está en venta.");
