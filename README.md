# Cantera

Tabla de jugadores con buscador, filtros, orden por columna y cálculo de posiciones. Es una página estática: un solo `index.html`.

## De dónde salen los datos

- **La lista de jugadores** sale de una hoja de Google Sheets (columna `PID`). Debe estar compartida como «Cualquier persona con el enlace puede ver».
- **Los datos de cada jugador** salen de la API de Sokker (`/api/player/{PID}`): nombre, edad, equipo, valor, forma, disciplina táctica, trabajo en equipo, experiencia y lesión.
- **Las skills** (resistencia, rapidez, técnica, pase, portero, defensa, creación, anotación) la API no las entrega para jugadores de otros equipos. Si las agregas a la hoja en columnas llamadas `RES`, `RAP`, `TEC`, `PAS`, `POR`, `DEF`, `CRE` y `ANO`, la página calcula las posiciones.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube `index.html` (y, si lo generas, la carpeta `data/`).
2. En el repositorio: Settings → Pages → «Deploy from a branch» → rama `main`, carpeta `/ (root)`.
3. En uno o dos minutos la página queda en `https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/`.

## Si el navegador no puede leer la API de Sokker

Si la página muestra «El navegador no pudo leer la API de Sokker», es un bloqueo CORS. Se resuelve generando los datos fuera del navegador:

1. Instala Node 18 o superior.
2. En esta carpeta, ejecuta `node fetch-players.mjs`. Crea `data/players.json`.
3. Sube `data/players.json` al repositorio.

Mientras exista ese archivo, la página lo usa y no llama a la API. Para actualizarlo, repite los pasos 2 y 3.

## Conectar con tu usuario de Sokker

El botón «Conectar a Sokker» abre un cuadro para escribir tu usuario y tu contraseña. Se envían directo a `sokker.org`; la página no los guarda. Con la sesión iniciada, la API entrega las skills de tus propios jugadores y de los que están en venta (no las de otros equipos).

Dos cosas pueden impedirlo:

- Los campos del login están en `CONFIG.loginFields` (`login` y `password`) y `CONFIG.loginExtra` (`remember: false`, es decir, no recordar la sesión). Deben coincidir con `LoginRequest` en https://sokker.org/apidoc.html, sección Schemas. Si Sokker responde que no acepta los datos, revísalos ahí.
- Los navegadores suelen bloquear las cookies de otro sitio. Si Sokker acepta el login pero la página no mantiene la sesión, usa el script.

**Con el script** (no depende del navegador). Con tu usuario y contraseña en variables de entorno, solo para esa ejecución:

- Windows (PowerShell): `$env:SOKKER_USER="tu_usuario"; $env:SOKKER_PASS="tu_contraseña"; node fetch-players.mjs`
- Mac o Linux: `SOKKER_USER="tu_usuario" SOKKER_PASS="tu_contraseña" node fetch-players.mjs`

El `data/players.json` que genera incluye lo que tu sesión puede ver. Si lo subes a un repositorio público, esos datos quedan públicos. Nunca subas tu contraseña.

## Configuración

Todo está al inicio del `<script>` de `index.html`, en `CONFIG`: título, ID de la hoja, nombre de la pestaña, tiempo de caché y concurrencia. El script `fetch-players.mjs` tiene su propio `SHEET_ID` al inicio.

## Columnas y botón de tema

- Después de las 8 skills hay 5 columnas de suma: **DEF** (defensa + rapidez), **DEFside** (creación + técnica + pase), **MID** (creación + rapidez + técnica + pase), **ATT** (rapidez + técnica + anotación) y **ATTside** (defensa + creación + pase). Si falta alguna skill del jugador, muestran "—".
- El botón redondo de la esquina superior derecha cambia entre modo claro y oscuro y recuerda tu elección. Si nunca lo usas, sigue el modo de tu sistema.
- Las columnas "Equipo" y las 7 de posiciones (Portero… Delantero) están ocultas. Para verlas, agrega al final de la dirección `?equipo=1` y/o `?posiciones=1` (por ejemplo `.../index.html?equipo=1&posiciones=1`).

## Equipos bot

Junto al nombre del jugador aparece "Equipo bot" cuando su equipo no tiene dueño. Se detecta con `GET /team/{id}/owner` (404 = sin dueño). `node fetch-players.mjs` lo guarda en `data/players.json` (clave `teams`), así que hay que volver a ejecutarlo para que aparezcan las etiquetas.

## Cambios semanales (flechas ▲▼)

- Cada vez que ejecutas `node fetch-players.mjs`, el script guarda además `data/players.prev.json`: el `players.json` de la semana anterior.
- La semana va de **jueves a miércoles**. El respaldo se renueva solo la primera vez que ejecutas el script cada jueves, y se conserva sin cambios hasta el miércoles siguiente. Puedes ejecutarlo varias veces en la semana sin perder la comparación.
- La página compara ambos archivos y marca con ▲ (subió) o ▼ (bajó) las skills que cambiaron. Al pasar el mouse se ve el valor anterior.
- Sube **los dos archivos** (`players.json` y `players.prev.json`) a la carpeta `data` del repositorio.
- No se marca nada si el jugador no tenía skills visibles en alguna de las dos semanas, ni si es nuevo en la hoja. La primera comparación aparece después de la segunda ejecución semanal.

## Contraseña de la página

Los datos se publican **cifrados** (`data/players.enc.json` y `data/players.prev.enc.json`). Quien abra la página debe escribir la contraseña; el navegador la recuerda en ese dispositivo, y el botón «Bloquear» la olvida.

- Al ejecutar `node fetch-players.mjs`, el script pide la contraseña de la página (mínimo 8 caracteres, mejor una frase larga). También puedes pasarla con la variable `SITE_PASSWORD`. No se escribe en ningún archivo.
- Sube a `data` solo los archivos `.enc.json`. **Borra del repositorio** `data/players.json` y `data/players.prev.json` si aún existen: están sin cifrar. Ojo: GitHub conserva el historial, así que lo que ya estuvo publicado sin cifrar sigue siendo recuperable desde commits antiguos.
- Para cambiar la contraseña, ejecuta el script con la nueva. Esa semana no habrá flechas (el respaldo anterior ya no se puede leer) y quienes tengan la contraseña vieja guardada verán el aviso para escribir la nueva.
- El cifrado protege los datos, no el código de la página (botones y diseño), que sigue siendo público. Una contraseña corta se puede adivinar por fuerza bruta.
- `node check-players.mjs` también lee el archivo cifrado, pidiendo la contraseña.
