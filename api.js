// api.js
export const supabase = window.supabase.createClient(
  "https://oikghpsfsqkrcaxeclcv.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pa2docHNmc3FrcmNheGVjbGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MDI3MjEsImV4cCI6MjA3OTE3ODcyMX0.iGHBr1uLm6DSyLV0V-TWmoIlWRFXF3E2dY4Wx3VPVZk"
);

// =======================
// USUARIO
// =======================
export async function obtenerUsuario(email) {
  return await supabase
    .from("usuario")
    .select("*")
    .eq("email", email)
    .single();
}

// =======================
// TELESCOPIO
// =======================
export async function obtenerTelescopios() {
  return await supabase
    .from("telescopio")
    .select("*")
    .order("id_telescopio", { ascending: true });
}

// =======================
// SESIONES
// =======================

// crear sesión ILIMITADA (fin_sesion null)
export async function crearSesionIlimitada(id_telescopio, id_usuario) {
  return await supabase
    .from("telescopio_sesion")
    .insert({
      id_telescopio,
      id_usuario,
      estado: "activa",
      fin_sesion: null
    })
    .select()
    .single();
}

// obtener sesión activa por telescopio (cualquier usuario)
export async function obtenerSesionActiva(id_telescopio) {
  return await supabase
    .from("telescopio_sesion")
    .select("*")
    .eq("id_telescopio", id_telescopio)
    .eq("estado", "activa")
    .order("inicio_sesion", { ascending: false })
    .limit(1)
    .maybeSingle();
}

// sesiones del usuario
export async function obtenerSesionesUsuario(id_usuario) {
  return await supabase
    .from("telescopio_sesion")
    .select("*")
    .eq("id_usuario", id_usuario)
    .order("inicio_sesion", { ascending: false });
}

// finalizar sesión manual (marca fin si no tenía)
export async function finalizarSesion(id_sesion) {
  return await supabase
    .from("telescopio_sesion")
    .update({
      estado: "finalizada",
      fin_sesion: new Date().toISOString()
    })
    .eq("id_sesion", id_sesion);
}

// =======================
// COLA FIFO
// =======================

export async function entrarCola(id_telescopio, id_usuario) {
  return await supabase
    .from("queue")
    .insert({ id_telescopio, id_usuario })
    .select()
    .single();
}

export async function obtenerColaFIFO(id_telescopio) {
  return await supabase
    .from("queue")
    .select("*")
    .eq("id_telescopio", id_telescopio)
    .order("timestamp_ingreso", { ascending: true });
}

// RPC para asignar siguiente
export async function asignarSiguienteDeCola(id_telescopio) {
  return await supabase.rpc("asignar_siguiente_cola", {
    p_id_telescopio: id_telescopio
  });
}

// borrar usuario de queue
export async function borrarDeColaUsuario(id_usuario){
  return await supabase
    .from("queue")
    .delete()
    .eq("id_usuario", id_usuario);
}

// finalizar sesiones activas del usuario
export async function finalizarSesionUsuario(id_usuario){
  return await supabase
    .from("telescopio_sesion")
    .update({
      estado: "finalizada",
      fin_sesion: new Date().toISOString()
    })
    .eq("id_usuario", id_usuario)
    .eq("estado", "activa");
}

// =======================
// OBSERVACIONES
// =======================
export async function registrarObservacion(dataObs) {
  return await supabase.from("observacion").insert(dataObs).select().single();
}

export async function obtenerObservaciones(id_sesion) {
  return await supabase
    .from("observacion")
    .select("*")
    .eq("id_sesion", id_sesion)
    .order("fecha_busqueda", { ascending: false });
}
// Marcar disponibilidad de una sesión
export async function marcarDisponibilidadSesion(id_sesion, disponible) {
  return await supabase
    .from("telescopio_sesion")
    .update({ disponible })
    .eq("id_sesion", id_sesion);
}

// Crear observación "en curso"
export async function crearObservacionEnCurso(data) {
  return await supabase
    .from("observacion")
    .insert(data)
    .select()
    .single();
}

// Finalizar observación (marca fecha_fin y estado = completada)
export async function finalizarObservacionDB(id_observacion) {
  return await supabase
    .from("observacion")
    .update({
      fecha_fin: new Date().toISOString(),
      estado: "completada"
    })
    .eq("id_observacion", id_observacion);
}
