/**
 * Cola offline genérica (núcleo Senda).
 *
 * Persiste operaciones pendientes en localStorage y las reenvía en orden
 * cuando hay conexión. El dominio define el tipo de operación y cómo se
 * ejecuta cada una; la cola solo orquesta: orden FIFO, tope con descarte de
 * la más antigua, reintento de las que fallen y protección contra flush
 * simultáneo.
 *
 * Semántica (idéntica a la cola original de Hábitos):
 * - `encolar` agrega al final; en disco se conservan las últimas `maxOps`.
 * - Si al encolar ya había `maxOps` en memoria, se avisa por `alDesbordar`
 *   (el cambio más antiguo se descartó del disco).
 * - `reenviar` no hace nada si ya hay un flush en curso o no hay pendientes.
 * - Cada operación se ejecuta en orden; la que falle (excepción o `false`)
 *   vuelve a la cola y se sigue con la siguiente (no se aborta el lote).
 */

export interface OpcionesColaSync<Op> {
  /** Clave de localStorage donde se persiste la cola. */
  clave: string;
  /** Tope de operaciones (defecto 200). */
  tope?: number;
  /** ¿Hay condiciones para intentar el flush? (p. ej. sesión e identidad) */
  puedeReenviar?: () => boolean;
  /** Gancho previo al flush (p. ej. refrescar el token de sesión). */
  antesDeReenviar?: () => Promise<void>;
  /**
   * Ejecuta una operación. Devuelve `true` si se completó (sale de la cola)
   * o `false` si debe reintentarse más tarde. Si lanza, también se reintenta.
   */
  ejecutar: (op: Op) => Promise<boolean>;
  /** Se llama cuando un enqueue descarta la operación más antigua por tope. */
  alDesbordar?: () => void;
}

export interface ColaSync<Op> {
  /** Agrega una operación al final de la cola y la persiste. */
  encolar(op: Op): void;
  /** Reenvía las pendientes en orden. Seguro de llamar en cualquier momento. */
  reenviar(): Promise<void>;
  /** Foto de las operaciones pendientes en memoria. */
  pendientes(): Op[];
  /** Vacía la cola (memoria y disco). Se usa al reiniciar la app. */
  vaciar(): void;
}

function leerCola<Op>(clave: string): Op[] {
  try {
    const raw = window.localStorage.getItem(clave);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Op[]) : [];
  } catch {
    return [];
  }
}

function guardarCola<Op>(clave: string, ops: Op[], tope: number): void {
  try {
    window.localStorage.setItem(clave, JSON.stringify(ops.slice(-tope)));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function crearColaSync<Op>(opts: OpcionesColaSync<Op>): ColaSync<Op> {
  const tope = opts.tope ?? 200;
  let ops: Op[] = leerCola<Op>(opts.clave);
  let reenviando = false;

  return {
    encolar(op: Op): void {
      const habiaTope = ops.length >= tope;
      ops = [...ops, op];
      guardarCola(opts.clave, ops, tope);
      if (habiaTope) opts.alDesbordar?.();
    },

    async reenviar(): Promise<void> {
      if (reenviando) return;
      if (opts.puedeReenviar && !opts.puedeReenviar()) return;
      if (ops.length === 0) return;
      // El guardia se toma ANTES de cualquier await: dos reenviar() concurrentes
      // no duplican el flush (en la cola original el flag se tomaba después de
      // `await asegurarSesion()` y la carrera existía).
      reenviando = true;
      try {
        await opts.antesDeReenviar?.();
        const restantes: Op[] = [];
        for (const op of ops) {
          try {
            const ok = await opts.ejecutar(op);
            if (!ok) restantes.push(op);
          } catch {
            restantes.push(op);
          }
        }
        ops = restantes;
        guardarCola(opts.clave, ops, tope);
      } finally {
        reenviando = false;
      }
    },

    pendientes(): Op[] {
      return ops;
    },

    vaciar(): void {
      ops = [];
      guardarCola(opts.clave, ops, tope);
    },
  };
}
