// domo_control.js
import {
  supabase,
  obtenerUsuario,
  obtenerTelescopios,
  obtenerSesionActiva,
  marcarDisponibilidadSesion,
  crearObservacionEnCurso,
  finalizarObservacionDB,
} from "./api.js";

// 🔧 CONFIG
const TELESCOPIO_ID = 1;
const ESP32_CONTROLLER_BASE = "http://10.104.5.153:8080"; // ESP32 controlador
const ESP32_CAM_BASE = "http://10.104.5.214";            // ESP32-CAM

let usuarioActual = null;
let sesionActiva = null;
let telescopioActual = null;
let observacionActual = null;

// DOM
const estadoSpan      = document.getElementById("estadoSesion");
const telescopioSpan  = document.getElementById("nombreTelescopio");
const mensajeEstado   = document.getElementById("mensajeEstado");
const btnApuntar      = document.getElementById("btnApuntar");
const btnFinalizar    = document.getElementById("btnFinalizar");
const imgCam          = document.getElementById("camStream");
const selectPlaneta   = document.getElementById("planetaSelect");

// ✅ Botón de descarga (agrega <a id="btnDescargarFoto"> en control.html)
const btnDescargarFoto = document.getElementById("btnDescargarFoto");

// ===================================================
//  INIT
// ===================================================
async function init() {
  const local = localStorage.getItem("papudomo_user");
  if (!local) {
    window.location.href = "registro.html";
    return;
  }
  const { email } = JSON.parse(local);

  const { data: user, error: uErr } = await obtenerUsuario(email);
  if (uErr || !user) {
    console.error(uErr);
    localStorage.removeItem("papudomo_user");
    window.location.href = "registro.html";
    return;
  }

  usuarioActual = user;
  document.getElementById("nombreUsuario").textContent =
    (user.nombre_usuario || email.split("@")[0]).toLowerCase();

  // Telescopios
  const { data: teles, error: tErr } = await obtenerTelescopios();
  if (tErr) {
    console.error(tErr);
    estadoSpan.textContent = "Error obteniendo telescopios.";
    return;
  }

  telescopioActual = teles.find(t => t.id_telescopio === TELESCOPIO_ID) || teles[0];

  if (!telescopioActual) {
    estadoSpan.textContent = "Sin telescopios registrados.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  telescopioSpan.textContent = telescopioActual.nombre;

  // Sesión activa
  const { data: sesion, error: sErr } = await obtenerSesionActiva(telescopioActual.id_telescopio);
  if (sErr) console.error(sErr);
  sesionActiva = sesion || null;

  await evaluarDisponibilidad();
  setInterval(evaluarDisponibilidad, 5000);
}

// ===================================================
//  ESTADO HARDWARE ESP32
// ===================================================
async function obtenerEstadoHardware() {
  try {
    const res = await fetch(`${ESP32_CONTROLLER_BASE}/status`, { method: "GET" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return { online: true, data };
  } catch (e) {
    console.warn("ESP32 no responde:", e.message);
    return { online: false, data: null };
  }
}

// ===================================================
//  EVALUAR DISPONIBILIDAD (BD + HARDWARE)
// ===================================================
async function evaluarDisponibilidad() {
  if (!telescopioActual) {
    estadoSpan.textContent = "Sin telescopio configurado.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  // Estado administrativo (tabla telescopio)
  if (telescopioActual.estado && telescopioActual.estado !== "disponible") {
    estadoSpan.textContent = `Telescopio en estado "${telescopioActual.estado}".`;
    mensajeEstado.textContent = "No disponible (mantenimiento / fuera de servicio).";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  // Estado físico hardware
  const hw = await obtenerEstadoHardware();
  if (!hw.online) {
    estadoSpan.textContent = "Telescopio apagado o sin conexión.";
    mensajeEstado.textContent = "Enciende el ESP32 controlador o revisa la red.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  // Estado sesión
  if (!sesionActiva) {
    estadoSpan.textContent = "No hay sesión activa sobre este telescopio.";
    mensajeEstado.textContent = "Obtén una sesión activa en el dashboard.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  const soyDuenoSesion = sesionActiva.id_usuario === usuarioActual.id_usuario;
  const disponible = sesionActiva.disponible !== false;

  if (!soyDuenoSesion) {
    estadoSpan.textContent = "Sesión activa de otro usuario.";
    mensajeEstado.textContent = "Espera tu turno en la cola FIFO.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = true;
    return;
  }

  if (!disponible) {
    estadoSpan.textContent = "Sesión activa en uso (observación en curso).";
    mensajeEstado.textContent = "Finaliza la observación actual para iniciar otra.";
    btnApuntar.disabled = true;
    btnFinalizar.disabled = false;
    return;
  }

  estadoSpan.textContent = "Sesión activa disponible.";
  mensajeEstado.textContent = "Puedes apuntar el domo a un planeta.";
  btnApuntar.disabled = false;
  btnFinalizar.disabled = true;
}

// ===================================================
//  TOMAR 1 FOTO + MOSTRAR + PREPARAR DESCARGA
// ===================================================
async function tomarUnaFoto(planetaLabel) {
  try {
    // Dispara
    await fetch(`${ESP32_CAM_BASE}/disparar`);

    // Mostrar (con cache buster)
    const ts = Date.now();
    const fotoURL = `${ESP32_CAM_BASE}/photo.jpg?ts=${ts}`;
    imgCam.src = fotoURL;

    // Preparar descarga si existe el botón <a id="btnDescargarFoto">
    if (btnDescargarFoto) {
      btnDescargarFoto.href = fotoURL;

      // nombre bonito: papudomo_Jupiter_2025-12-17_22-10-05.jpg
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const nombre =
        `papudomo_${planetaLabel}_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
        `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.jpg`;

      btnDescargarFoto.download = nombre;
      btnDescargarFoto.style.pointerEvents = "auto";
      btnDescargarFoto.style.opacity = "1";
    }

  } catch (e) {
    console.error("Error tomando foto:", e);
    mensajeEstado.textContent = "Error al tomar la foto desde la cámara.";
  }
}

// ===================================================
//  APUNTAR DOMO
// ===================================================
btnApuntar.addEventListener("click", async () => {
  if (!sesionActiva || !usuarioActual) return;

  const planetaName = selectPlaneta.value; // para Stellarium/ESP32
  const planetaLabel = selectPlaneta.options[selectPlaneta.selectedIndex].text; // para BD

  try {
    btnApuntar.disabled = true;
    mensajeEstado.textContent = `Apuntando domo a ${planetaLabel}...`;

    // 1) sesión no disponible
    await marcarDisponibilidadSesion(sesionActiva.id_sesion, false);

    // 2) crear observación
    const { data: obs, error: oErr } = await crearObservacionEnCurso({
      id_sesion: sesionActiva.id_sesion,
      objeto_celeste: planetaLabel,
      fecha_inicio: new Date().toISOString(),
      estado: "en curso",
      usuario_control: usuarioActual.id_usuario,
    });

    if (oErr) {
      console.error(oErr);
      mensajeEstado.textContent = "Error creando observación en BD.";
      await marcarDisponibilidadSesion(sesionActiva.id_sesion, true);
      btnApuntar.disabled = false;
      return;
    }

    observacionActual = Array.isArray(obs) ? obs[0] : obs;

    // 3) mandar orden al controlador
    try {
      await fetch(
        `${ESP32_CONTROLLER_BASE}/apuntar?objeto=${encodeURIComponent(planetaName)}`
      );
    } catch (e) {
      console.error("Error llamando al ESP32 controlador:", e);
      // si falla el controlador, liberamos la sesión en BD
      mensajeEstado.textContent = "Error: no se pudo contactar al ESP32 controlador.";
      await marcarDisponibilidadSesion(sesionActiva.id_sesion, true);
      btnApuntar.disabled = false;
      return;
    }

    // 4) ✅ SOLO UNA FOTO (sin stream)
    await tomarUnaFoto(planetaLabel);

    estadoSpan.textContent = `Observando ${planetaLabel}`;
    mensajeEstado.textContent = `Foto capturada apuntando a ${planetaLabel}.`;
    btnFinalizar.disabled = false;

  } catch (e) {
    console.error(e);
    mensajeEstado.textContent = "Error general al iniciar la observación.";
    btnApuntar.disabled = false;
    await marcarDisponibilidadSesion(sesionActiva.id_sesion, true);
  }
});

// ===================================================
//  FINALIZAR OBSERVACIÓN
// ===================================================
btnFinalizar.addEventListener("click", async () => {
  if (!observacionActual || !sesionActiva) return;

  btnFinalizar.disabled = true;
  mensajeEstado.textContent = "Finalizando observación...";

  try {
    await finalizarObservacionDB(observacionActual.id_observacion);
    await marcarDisponibilidadSesion(sesionActiva.id_sesion, true);

    estadoSpan.textContent = "Sesión activa disponible.";
    mensajeEstado.textContent = "Observación finalizada. Puedes iniciar otra.";
    btnApuntar.disabled = false;
    observacionActual = null;

    await evaluarDisponibilidad();
  } catch (e) {
    console.error(e);
    mensajeEstado.textContent = "Error al finalizar la observación.";
    btnFinalizar.disabled = false;
  }
});

// ===================================================
//  ARRANQUE
// ===================================================
init();

