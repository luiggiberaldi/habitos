// Prueba E2E del punto de reorden (0037) con un producto desechable.
// 1. Crea "Prueba Umbral" (stock 0) → 2. umbral 5 → debe pasar a lista
// 3. compra 10 (sin cuenta) → 4. marcar comprado → 5. consumo 6 → debe reactivar
// 6. Limpieza total. Falla con exit 1 si algo no cuadra.
import { cargarConfig } from "./whatsapp-comun.mjs";

function crearRpcFin(cfg) {
  return async function rpc(fn, params) {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.ANON_KEY,
        Authorization: `Bearer ${cfg.ANON_KEY}`,
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

const NOMBRE = "Prueba Umbral";
let prodId;
// Limpieza previa por si quedó de otra corrida
await rpc("rpc_mer_producto_actualizar", { p_user_id: uid, p_producto_id: "00000000-0000-0000-0000-000000000000" }).catch(() => {});

// 1. Crear ficha
const up = await rpc("rpc_mer_producto_upsert", {
  p_user_id: uid, p_nombre: NOMBRE, p_unidad: "und", p_categoria: "pruebas", p_precio_ref: null,
});
prodId = up.id;
assert(up.ok, "ficha creada");

// Normalizar: si la ficha venía de otra corrida con stock, llevarlo a 0
// para que el test sea determinista.
{
  const inv0 = await rpc("rpc_mer_inventario", { p_user_id: uid });
  const it0 = inv0.find((x) => x.id === prodId);
  if (it0 && Number(it0.stock) > 0) {
    await rpc("rpc_mer_movimiento", {
      p_user_id: uid, p_producto_id: prodId, p_tipo: "consumo",
      p_cantidad: Number(it0.stock), p_nota: "normalizar test",
    });
    console.log("ok: stock normalizado a 0");
  }
}

// 2. Umbral 5 con stock 0 → debe pasar a lista de inmediato
// (0040b: el alta ya lo metió en la lista al crearlo en 0, así que aquí no
// hay cambio de estado — paso_a_lista=false es correcto; lo que importa es
// que siga pendiente)
const u1 = await rpc("rpc_mer_producto_actualizar", { p_user_id: uid, p_producto_id: prodId, p_stock_minimo: 5 });
assert(u1.stock_minimo === 5 || u1.stock_minimo == 5, "umbral guardado = 5");
const lista1 = await rpc("rpc_mer_lista", { p_user_id: uid });
assert(lista1.some((l) => l.producto_id === prodId && l.estado === "pendiente"), "en lista pendiente");

// 3. Compra 10 (sin cuenta → sin finanzas) → stock 10 > 5, sin aviso nuevo
const c1 = await rpc("rpc_mer_movimiento", {
  p_user_id: uid, p_producto_id: prodId, p_tipo: "compra", p_cantidad: 10,
  p_precio_total: 20, p_moneda: "VES", p_nota: "prueba umbral",
});
assert(c1.paso_a_lista === false, "compra sobre el umbral no re-avisa");

// 4. Sacar de pendiente (simula "comprado") y consumir 6 → stock 4 <= 5 → reactiva
await rpc("rpc_mer_lista_toggle", { p_user_id: uid, p_producto_id: prodId, p_cantidad: 1, p_estado: "comprado" });
const d1 = await rpc("rpc_mer_movimiento", {
  p_user_id: uid, p_producto_id: prodId, p_tipo: "consumo", p_cantidad: 6, p_nota: "prueba umbral",
});
assert(d1.paso_a_lista === true, "consumo bajo el umbral reactiva la lista");
const lista2 = await rpc("rpc_mer_lista", { p_user_id: uid });
assert(lista2.some((l) => l.producto_id === prodId && l.estado === "pendiente"), "lista vuelve a pendiente");

// 5. Inventario expone stock_minimo + bajo_minimo
const inv = await rpc("rpc_mer_inventario", { p_user_id: uid });
const it = inv.find((p) => p.id === prodId);
assert(it && Number(it.stock_minimo) === 5 && it.bajo_minimo === true, "inventario muestra umbral y bajo_minimo");

// 6. Limpieza
await rpc("rpc_mer_producto_actualizar", { p_user_id: uid, p_producto_id: prodId, p_activo: false });
console.log(JSON.stringify({ ok: true, msg: "E2E punto de reorden: todo pasó" }));
