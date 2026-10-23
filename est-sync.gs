// Servicio para compartir entre dispositivos las asignaciones GK / DEF / MID / ATT de la página CYMRU U21.
// Se pega en el Apps Script de tu hoja de Google (Extensiones → Apps Script). Pasos en el README.
//
// - Guarda los datos en una pestaña nueva llamada EST de tu misma hoja (columnas: pid, valor, t).
// - El valor llega CIFRADO desde la página con tu contraseña: ni Google ni quien tenga la dirección puede leerlo.
// - Para escribir se exige una clave que deriva de tu contraseña. Se fija la primera vez que se guarda algo.
//   Si cambias la contraseña de la página, ejecuta una vez la función reiniciarClave() (menú de arriba).

const HOJA = "EST";

function doGet(e) {
  const p = (e && e.parameter) || {};
  CALLBACK_ = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(String(p.callback || "")) ? String(p.callback) : "";
  try {
    if (p.action === "set") return respuesta_(guardar_(p));
    return respuesta_(listar_());
  } catch (err) {
    return respuesta_({ ok: false, error: String(err && err.message || err) });
  }
}

// Si la petición trae «callback», responde en formato JSONP («funcion({...})»): así la página puede leerlo
// aunque el navegador bloquee la lectura directa entre sitios.
let CALLBACK_ = "";
function respuesta_(obj) {
  const texto = JSON.stringify(obj);
  if (CALLBACK_) return ContentService.createTextOutput(CALLBACK_ + "(" + texto + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

function hoja_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(HOJA);
  if (!sh) { sh = ss.insertSheet(HOJA); sh.appendRow(["pid", "valor", "t"]); }
  return sh;
}

function listar_() {
  const sh = hoja_();
  const filas = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  return { ok: true, items: filas.filter(f => f[0] !== "").map(f => ({ pid: String(f[0]), v: String(f[1] || ""), t: Number(f[2]) || 0 })) };
}

function guardar_(p) {
  const pid = String(p.pid || "");
  if (!/^\d+$/.test(pid)) throw new Error("pid inválido");
  if (!/^[A-Za-z0-9_-]{0,200}$/.test(String(p.v || ""))) throw new Error("valor inválido");
  const t = Number(p.t) || Date.now();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const props = PropertiesService.getScriptProperties();
    const token = String(p.token || "");
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("token inválido");
    const guardado = props.getProperty("TOKEN");
    if (!guardado) props.setProperty("TOKEN", token);        // la primera vez fija la clave
    else if (guardado !== token) throw new Error("token no coincide");
    const sh = hoja_();
    const ult = sh.getLastRow();
    let fila = -1;
    if (ult > 1) {
      const pids = sh.getRange(2, 1, ult - 1, 1).getValues();
      for (let i = 0; i < pids.length; i++) if (String(pids[i][0]) === pid) { fila = i + 2; break; }
    }
    if (fila < 0) sh.appendRow([pid, String(p.v || ""), t]);
    else if (t >= Number(sh.getRange(fila, 3).getValue()) || 0) sh.getRange(fila, 2, 1, 2).setValues([[String(p.v || ""), t]]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Ejecútala una vez si cambias la contraseña de la página: la próxima vez que guardes algo se fijará la clave nueva.
function reiniciarClave() {
  PropertiesService.getScriptProperties().deleteProperty("TOKEN");
}
