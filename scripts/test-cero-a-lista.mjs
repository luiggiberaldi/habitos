// Prueba E2E de la migración 0040 (productos en 0 van a la lista) con producto desechable.
// 1. Crea "Prueba Cero" (stock 0) → debe pasar a lista (pendiente)
// 2. Compra 5 (directa, como "mercado compré X") → debe SALIR de la lista (novedad 0040)
// 3. Consumo 5 → stock 0 → debe VOLVER a la lista
// 4. Limpieza total. Falla con exit 1 si algo no cuadra.
import { cargarConfig } from "./whatsapp-comun.mjs";

function crearRpcFin(cfg) {
  return async function rpc(fn, params) {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.ANON_KEY,
        Authorization: "Bearer " + cfg.ANON_KEY,
        "x-fin-rpc-secret": cfg.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}
const cfg = cargarConfig({});
const rpc = crearRpcFin(cfg);
const uid = cfg.USER_ID;
const assert = (c, msg) => { if (!c) { console.error("FALLO:", msg); process.exit(1); } console.log("ok:", msg); };

const NOMBRE = "Prueba Cero";
async function enLista(pid) {
  const lista = await rpc("rpc_mer_lista", { p_user_id: uid });
  return lista.some((l) => l.producto_id === pid && l.estado === "pendiente");
}
async function limpiar() {
  const lista = await rpc("rpc_mer_lista", { p_user_id: uid }).catch(() => []);
  const it = lista.find((l) => l.nombre === NOMBRE);
  if (it) await rpc("rpc_mer_lista_toggle", { p_user_id: uid, p_producto_id: it.producto_id, p_estado: "comprado" }).catch(() => {});
  const inv = await rpc("rpc_mer_inventario", { p_user_id: uid }).catch(() => []);
  const p = inv.find((x) => x.nombre === NOMBRE);
  if (p) await rpc("rpc_mer_producto_actualizar", { p_user_id: uid, p_producto_id: p.id, p_activo: false }).catch(() => {});
}
await limpiar();

// 1. Crear ficha en 0 → debe pasar a lista
const up = await rpc("rpc_mer_producto_upsert", {
  p_user_id: uid, p_nombre: NOMBRE, p_unidad: "und", p_categoria: "pruebas", p_precio_ref: null,
});
const prodId = up.id;
assert(up.ok, "ficha creada");
assert(await enLista(prodId), "producto en 0 pasa a la lista (pendiente)");

// 2. Compra directa 5 (como "mercado compré 5 prueba cero") → debe SALIR de la lista
const c1 = await rpc("rpc_mer_movimiento", {
  p_user_id: uid, p_producto_id: prodId, p_tipo: "compra", p_cantidad: 5,
  p_precio_total: 10, p_moneda: "USD",
});
assert(c1.ok, "compra registrada");
assert(!(await enLista(prodId)), "0040: la compra saca el producto de la lista");

// 3. Consumo 5 → stock 0 → debe VOLVER a la lista
const c2 = await rpc("rpc_mer_movimiento", {
  p_user_id: uid, p_producto_id: prodId, p_tipo: "consumo", p_cantidad: 5,
});
assert(c2.ok, "consumo registrado");
assert(c2.paso_a_lista === true, "paso_a_lista=true al quedar en 0");
assert(await enLista(prodId), "producto en 0 vuelve a la lista");

// 4. El inventario (vista alacena) lo filtra: verificar que el RPC trae stock 0
const inv = await rpc("rpc_mer_inventario", { p_user_id: uid });
const item = inv.find((x) => x.id === prodId);
assert(item && item.stock === 0, "RPC trae el producto con stock 0 (el filtro es de presentación)");

await limpiar();
const inv2 = await rpc("rpc_mer_inventario", { p_user_id: uid });
assert(!inv2.some((x) => x.nombre === NOMBRE && x.activo !== false), "producto desechable desactivado");
console.log("E2E 0040: 8/8 PASS");
