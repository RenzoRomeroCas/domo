// dashboard.js
import {
  supabase,
  obtenerUsuario,
  obtenerTelescopios,
  obtenerSesionesUsuario,
  obtenerColaFIFO,
  obtenerSesionActiva,
  crearSesionIlimitada,
  entrarCola,
  finalizarSesion,
  asignarSiguienteDeCola
} from "./api.js";

async function iniciarDashboard() {
  const local = localStorage.getItem("papudomo_user");
  if (!local) {
    window.location.href = "registro.html";
    return;
  }

  const { email } = JSON.parse(local);

  // Usuario
  const { data: user, error: uErr } = await obtenerUsuario(email);
  if (uErr || !user) {
    console.error(uErr);
    alert("Error obteniendo usuario. Inicia sesión de nuevo.");
    localStorage.removeItem("papudomo_user");
    window.location.href = "registro.html";
    return;
  }

  document.getElementById("nombreUsuario").textContent =
    (user.nombre_usuario || email.split("@")[0]).toLowerCase();

  // Telescopios y cola
  const { data: teles } = await obtenerTelescopios();
  const contT = document.getElementById("listaTelescopios");
  contT.innerHTML = "";

  for (const t of teles) {
    const { data: cola } = await obtenerColaFIFO(t.id_telescopio);
    const { data: sesionActiva } = await obtenerSesionActiva(t.id_telescopio);

    contT.innerHTML += `
      <div class="card glass" style="margin-top:12px;">
        <h3 style="margin-bottom:6px;">${t.nombre}</h3>
        <p>Estado: <b>${t.estado}</b></p>
        <p>Cola FIFO: <b>${cola?.length || 0}</b> esperando</p>
        <p>Sesión activa: <b>${sesionActiva ? "SÍ" : "NO"}</b></p>

        <button onclick="solicitarAcceso(${t.id_telescopio})"
                style="margin-top:8px; padding:10px 16px; border-radius:10px; border:none; cursor:pointer; font-weight:bold;">
          Solicitar acceso
        </button>
      </div>
    `;
  }

  // Mis sesiones
  const { data: sesiones } = await obtenerSesionesUsuario(user.id_usuario);
  const contS = document.getElementById("misSesiones");
  contS.innerHTML = "";

  sesiones.forEach(s => {
    contS.innerHTML += `
      <div class="card glass" style="margin-top:12px;">
        <p><strong>Sesión:</strong> ${s.id_sesion}</p>
        <p><strong>Inicio:</strong> ${new Date(s.inicio_sesion).toLocaleString()}</p>
        <p><strong>Fin:</strong> ${s.fin_sesion ? new Date(s.fin_sesion).toLocaleString() : "ILIMITADO"}</p>
        <p><strong>Estado:</strong> ${s.estado}</p>
        <p id="timer-${s.id_sesion}" style="margin-top:6px;font-weight:700;"></p>

        ${s.estado === "activa" ? `
          <button onclick="cerrarSesion('${s.id_sesion}', ${s.id_telescopio})"
                  style="margin-top:8px; padding:8px 14px; border-radius:8px; border:none; cursor:pointer;">
            Finalizar sesión
          </button>` : ""}
      </div>
    `;

    if (s.fin_sesion && s.estado === "activa") {
      iniciarTimer(s.id_sesion, s.fin_sesion, s.id_telescopio);
    }
  });
}

// Regla de acceso
window.solicitarAcceso = async function(id_telescopio) {
  const local = JSON.parse(localStorage.getItem("papudomo_user"));
  const { data: user } = await obtenerUsuario(local.email);

  const { data: cola } = await obtenerColaFIFO(id_telescopio);
  const { data: sesionActiva } = await obtenerSesionActiva(id_telescopio);

  // Si no hay sesión activa y cola vacía => ILIMITADA
  if ((!cola || cola.length === 0) && !sesionActiva) {
    const { error } = await crearSesionIlimitada(id_telescopio, user.id_usuario);
    if (error) {
      alert("No se pudo crear sesión: " + error.message);
      return;
    }
    alert("Sesión iniciada ILIMITADA hasta que alguien más entre a cola.");
    location.reload();
    return;
  }

  // Si hay sesión activa o cola => entra FIFO
  const { error } = await entrarCola(id_telescopio, user.id_usuario);
  if (error) {
    // si es por índice único => ya estabas esperando
    if (error.message?.includes("ux_queue_telescopio_usuario")) {
      alert("Ya estás en cola. Espera tu turno.");
      return;
    }
    alert("No se pudo entrar a cola: " + error.message);
    return;
  }

  alert("Ingresaste a la cola FIFO. Cuando te toque tendrás 10 minutos.");
  location.reload();
};

// Cronómetro
function iniciarTimer(idSesion, finSesion, idTelescopio){
  const el = document.getElementById(`timer-${idSesion}`);
  const fin = new Date(finSesion).getTime();

  const interval = setInterval(async ()=>{
    const now = Date.now();
    const diff = fin - now;

    if(diff <= 0){
      el.textContent = "Tiempo terminado";
      clearInterval(interval);

      await finalizarSesion(idSesion);
      await asignarSiguienteDeCola(idTelescopio);

      location.reload();
      return;
    }

    const min = Math.floor(diff/60000);
    const sec = Math.floor((diff%60000)/1000);
    el.textContent = `Tiempo restante: ${min}m ${sec}s`;
  },1000);
}

// Fin manual
window.cerrarSesion = async function(idSesion, idTelescopio){
  await finalizarSesion(idSesion);
  await asignarSiguienteDeCola(idTelescopio);
  alert("Sesión finalizada. Se asignó el siguiente turno.");
  location.reload();
};

// =======================
// REALTIME: si me crean sesión activa => mostrar modal
// =======================
async function activarRealtimeTurno() {
  const local = localStorage.getItem("papudomo_user");
  if (!local) return;

  const { email } = JSON.parse(local);
  const { data: perfil } = await obtenerUsuario(email);
  if (!perfil) return;

  const idUsuario = perfil.id_usuario;

  supabase
    .channel("turno_fifo")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "telescopio_sesion",
      },
      (payload) => {
        const sesion = payload.new;
        if (sesion.id_usuario === idUsuario && sesion.estado === "activa") {
          mostrarModalTurno(sesion.fin_sesion);
        }
      }
    )
    .subscribe();
}

function mostrarModalTurno(finSesion){
  const modal = document.getElementById("turnoModal");
  const tiempo = document.getElementById("turnoTiempo");
  const btn = document.getElementById("btnTurnoOk");

  if (!modal) return;

  tiempo.textContent = finSesion ? "10 minutos" : "tiempo ilimitado";
  modal.classList.remove("hidden");

  btn.onclick = () => {
    modal.classList.add("hidden");
    window.location.reload();
  };
}

iniciarDashboard();
activarRealtimeTurno();
