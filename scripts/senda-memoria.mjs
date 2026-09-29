// senda-memoria.mjs — Memoria conversacional de Senda (prototipo, ES module).
//
// El asistente de WhatsApp puede GUARDAR cosas que Luigi le dice y BUSCARLAS
// después por similitud, sin API key ni red para los embeddings.
//
//   node scripts/senda-memoria.mjs guardar --q "el arroz lo compro en Makro"
//--                                  [--modulo mercado]
//   node scripts/senda-memoria.mjs buscar  --q "dónde compro el arroz"
//                                  [--limite 5] [--modulo mercado]
//   node scripts/senda-memoria.mjs borrar  --id <uuid>
//   node scripts/senda-memoria.mjs listar  [--limite 20] [--modulo mercado]
//
// Siempre JSON a stdout. HABITOS_MOCK=1 → tienda en memoria (sin red),
// útil para pruebas deterministas.
//
// Embedder LOCAL multilingual-e5-small (scripts/senda-embed.mjs, 384 dims):
//   - sin API key ni red (OpenAI está bloqueado en Venezuela)
//   - determinista bit a bit en CPU, L2-normalizado
//   - documentos con "passage: ", consultas con "query: " (convención e5)
// Para semántica por palabras compartidas ver git history (embedder hash FNV).

import { cargarConfig, crearRpc } from "./whatsapp-comun.mjs";
import { embed, embedDoc, embedQuery, coseno, DIMS } from "./senda-embed.mjs";

export { DIMS, embed, embedDoc, embedQuery, coseno };

// ── Store (RPC real o memoria en HABITOS_MOCK) ────────────────────────────
const mockTienda = [];

function crearStore(cfg) {
  const rpc = crearRpc(cfg);
  const esMock = !!process.env.HABITOS_MOCK;
  return {
    async guardar(userId, texto, modulo) {
      const vec = await embedDoc(texto);
      if (esMock) {
        const id = `mock-${mockTienda.length + 1}`;
        mockTienda.push({ id, user_id: userId, texto: texto.trim(), embedding: vec, modulo, created_at: new Date().toISOString() });
        return id;
      }
      return rpc("rpc_senda_memoria_guardar", {
        p_user_id: userId,
        p_texto: texto,
        p_embedding: vec,
        p_modulo: modulo,
      });
    },
    async buscar(userId, texto, limite, modulo) {
      const vec = await embedQuery(texto);
      if (esMock) {
        return mockTienda
          .filter((m) => m.user_id === userId && (!modulo || m.modulo === modulo))
          .map((m) => ({ ...m, distancia: 1 - coseno(vec, m.embedding) }))
          .sort((a, b) => a.distancia - b.distancia)
          .slice(0, limite)
          .map(({ embedding, user_id, ...r }) => r);
      }
      return rpc("rpc_senda_memoria_buscar", {
        p_user_id: userId,
        p_embedding: vec,
        p_limite: limite,
        p_modulo: modulo || null,
      });
    },
    async borrar(userId, id) {
      if (esMock) {
        const i = mockTienda.findIndex((m) => m.id === id && m.user_id === userId);
        if (i < 0) return false;
        mockTienda.splice(i, 1);
        return true;
      }
      return rpc("rpc_senda_memoria_borrar", { p_user_id: userId, p_id: id });
    },
    async listar(userId, limite, modulo) {
      if (esMock) {
        return mockTienda
          .filter((m) => m.user_id === userId && (!modulo || m.modulo === modulo))
          .slice(-limite)
          .reverse()
          .map(({ embedding, user_id, ...r }) => r);
      }
      // Sin RPC de listar: buscar con vector neutro no ordena por fecha;
      // el prototipo lista vía buscar con texto vacío es inútil, así que
      // en modo real listar no está soportado aún.
      throw new Error("listar solo disponible en HABITOS_MOCK=1 (prototipo)");
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else o._.push(a);
  }
  return o;
}

const ok = (data) => console.log(JSON.stringify({ ok: true, ...data }));
const fail = (codigo, detalle) => {
  console.log(JSON.stringify({ ok: false, codigo, detalle }));
  process.exitCode = 1;
};

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  try {
    const cfg = cargarConfig(a);
    const store = crearStore(cfg);
    const modulo = (a.modulo || "general").toString().trim() || "general";

    if (cmd === "guardar") {
      const q = (a.q || "").toString().trim();
      if (!q) return fail("sin-texto", "falta --q con el texto a recordar");
      const id = await store.guardar(cfg.USER_ID, q, modulo);
      return ok({ id, comando: "guardar" });
    }
    if (cmd === "buscar") {
      const q = (a.q || "").toString().trim();
      if (!q) return fail("sin-texto", "falta --q con la búsqueda");
      const limite = Math.max(1, Math.min(50, parseInt(a.limite || "5", 10) || 5));
      const res = await store.buscar(cfg.USER_ID, q, limite, a.modulo ? modulo : null);
      return ok({ resultados: res, comando: "buscar" });
    }
    if (cmd === "borrar") {
      if (!a.id) return fail("sin-id", "falta --id");
      const borrado = await store.borrar(cfg.USER_ID, a.id.toString());
      return ok({ borrado, comando: "borrar" });
    }
    if (cmd === "listar") {
      const limite = Math.max(1, Math.min(50, parseInt(a.limite || "20", 10) || 20));
      const res = await store.listar(cfg.USER_ID, limite, a.modulo ? modulo : null);
      return ok({ resultados: res, comando: "listar" });
    }
    return fail("sin-comando", "usa: guardar|buscar|borrar|listar --q ...");
  } catch (e) {
    return fail("error", String(e.message || e));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { crearStore, mockTienda };
