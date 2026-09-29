// senda-embed.mjs — Embedder local multilingual-e5-small (384 dims).
//
// Sin API key, sin red (después de la primera descarga del modelo),
// determinista bit a bit en CPU. OpenAI está bloqueado en Venezuela,
// así que este es el embedder de producción de la memoria de Senda.
//
// El modelo vive en ~/workspace/senda-memoria/.model-cache (caché estable
// fuera de node_modules). Se carga perezosamente en el primer embed()
// (~5s, 465MB en RAM); después cada embedding tarda milisegundos.
//
// Convención e5 (importa para la calidad):
//   - documentos (guardar) → prefijo "passage: "
//   - consultas  (buscar)  → prefijo "query: "

export const DIMS = 384;

const MODEL = "Xenova/multilingual-e5-small";
// Ruta exacta al bundle Node del paquete (instalado en senda-memoria,
// no en este repo): evita reinstalar ~500MB aquí.
const PKG_URL =
  "file:///home/hatch/workspace/senda-memoria/node_modules/@huggingface/transformers/dist/transformers.node.mjs";
const CACHE_DEFAULT = "/home/hatch/workspace/senda-memoria/.model-cache";

let extractor = null;

async function getExtractor() {
  if (!extractor) {
    const { pipeline, env } = await import(PKG_URL);
    env.cacheDir = process.env.SENDA_MODEL_CACHE || CACHE_DEFAULT;
    extractor = await pipeline("feature-extraction", MODEL);
  }
  return extractor;
}

async function embedConPrefijo(texto, prefijo) {
  const ex = await getExtractor();
  const salida = await ex(prefijo + String(texto || ""), {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(salida.data);
}

/** Embedding de un documento para GUARDAR. */
export async function embedDoc(texto) {
  return embedConPrefijo(texto, "passage: ");
}

/** Embedding de una consulta para BUSCAR. */
export async function embedQuery(texto) {
  return embedConPrefijo(texto, "query: ");
}

/** Compatibilidad: embed() equivale a embedDoc(). */
export async function embed(texto) {
  return embedDoc(texto);
}

/** Coseno entre vectores ya normalizados = producto punto. */
export function coseno(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
