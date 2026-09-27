// lib/foto.ts — Foto personalizada como avatar de perfil.
//
// Recorta la imagen al centro en cuadrado, la reduce a 256px y la comprime
// a JPEG. El resultado (~15–40 KB) se guarda como dataURL en `Perfil.foto`
// y cabe sin problema en el localStorage del perfil.

export const FOTO_TAMANO = 256;
export const FOTO_CALIDAD = 0.82;

export function esImagenValida(file: File): boolean {
  return file.type.startsWith("image/");
}

function leerComoDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(file);
  });
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    img.src = src;
  });
}

/**
 * Procesa la foto elegida: recorte cuadrado centrado + resize a 256px +
 * compresión JPEG. Devuelve el dataURL listo para `Perfil.foto`.
 * Lanza Error con mensaje en español si algo falla.
 */
export async function procesarFoto(file: File): Promise<string> {
  if (!esImagenValida(file)) throw new Error("El archivo no es una imagen.");
  const src = await leerComoDataURL(file);
  const img = await cargarImagen(src);
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  if (lado <= 0) throw new Error("La imagen no tiene tamaño válido.");
  const sx = (img.naturalWidth - lado) / 2;
  const sy = (img.naturalHeight - lado) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = FOTO_TAMANO;
  canvas.height = FOTO_TAMANO;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.drawImage(img, sx, sy, lado, lado, 0, 0, FOTO_TAMANO, FOTO_TAMANO);
  return canvas.toDataURL("image/jpeg", FOTO_CALIDAD);
}
