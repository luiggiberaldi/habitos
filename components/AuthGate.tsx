"use client";

import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getSupabase, getCachedUser } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";
import Logo from "./Logo";
import CampoClave from "./CampoClave";
import SelectorPerfiles from "./SelectorPerfiles";
import Onboarding, { type DatosOnboarding } from "./Onboarding";
import { IconAlerta } from "../lib/icons";
import {
  cargarPerfiles,
  crearPrimerPerfil,
  fijarPerfilActivo,
  leerPerfilActivoId,
  marcarUsoPerfil,
  sincronizarPerfilesPendientes,
  type Perfil,
} from "../lib/perfiles";

interface AuthContextValue {
  user: User | null;
  cargando: boolean;
  /** Hay sesión cacheada pero sin conexión: la app funciona offline y sincroniza sola. */
  sinConexion: boolean;
  cerrarSesion: () => Promise<void>;
  /** Perfiles en la nube de esta cuenta (caché offline incluida). */
  perfiles: Perfil[];
  /** Id del perfil activo (null = selector). */
  perfilId: string | null;
  /** Perfil activo o null. */
  perfil: Perfil | null;
  cargandoPerfiles: boolean;
  entrarAPerfil: (id: string) => void;
  /** Vuelve al selector de perfiles. */
  salirAPerfil: () => void;
  recargarPerfiles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthGate>");
  return ctx;
}

/** Limpieza única de restos del antiguo sistema de modos locales. */
function limpiarRestosViejos(): void {
  try {
    for (const k of ["habitos-modo-auth-v1", "habitos-perfiles-v1"]) {
      window.localStorage.removeItem(k);
    }
  } catch {
    /* almacenamiento no disponible */
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // La sesión se resuelve async: no mostrar el login hasta saber si hay
  // sesión cacheada (getSession no toca la red: arranca sin conexión).
  const supabase = getSupabase();
  // Sin Supabase configurado no hay sesión que resolver (modo local de desarrollo).
  const [authLista, setAuthLista] = useState(!supabase);
  const [sinConexion, setSinConexion] = useState(false);

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [perfilId, setPerfilId] = useState<string | null>(null);
  const [cargandoPerfiles, setCargandoPerfiles] = useState(false);
  /** El usuario omitió el asistente inicial: muestra el selector vacío. */
  const [saltoOnboarding, setSaltoOnboarding] = useState(false);

  const recargarPerfiles = async (): Promise<void> => {
    if (!user) return;
    const lista = await cargarPerfiles(user.id);
    setPerfiles(lista);
  };

  useEffect(() => {
    limpiarRestosViejos();
    if (!supabase) return;

    let activo = true;
    getCachedUser().then((u) => {
      if (!activo) return;
      setUser(u);
      // Sesión cacheada + sin red: entrar igual en modo offline.
      if (u && typeof navigator !== "undefined" && !navigator.onLine) setSinConexion(true);
      setAuthLista(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!activo) return;
      setUser(session?.user ?? null);
      setAuthLista(true);
    });

    const onOnline = () => setSinConexion(false);
    const onOffline = () => setSinConexion(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [supabase]);

  // Cargar perfiles al iniciar sesión (nube, con caché offline).
  // Todo el setState vive dentro del flujo async: set-state-in-effect no
  // permite setState síncrono en el cuerpo del efecto.
  useEffect(() => {
    let activo = true;
    void (async () => {
      if (!supabase || !user) {
        if (!activo) return;
        setPerfiles([]);
        setPerfilId(null);
        setCargandoPerfiles(false);
        setSaltoOnboarding(false);
        return;
      }
      setCargandoPerfiles(true);
      // Subir primero los creados sin red, luego leer la lista real.
      await sincronizarPerfilesPendientes(user.id).catch(() => {});
      const lista = await cargarPerfiles(user.id);
      if (!activo) return;
      setPerfiles(lista);
      const recordado = leerPerfilActivoId();
      if (recordado && lista.some((p) => p.id === recordado)) {
        setPerfilId(recordado);
        void marcarUsoPerfil(user.id, recordado);
      }
      setCargandoPerfiles(false);
    })();
    return () => {
      activo = false;
    };
  }, [supabase, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al volver la red, reintentar subir perfiles creados offline.
  useEffect(() => {
    if (!user) return;
    const onOnline = () => {
      void sincronizarPerfilesPendientes(user.id).then(() => recargarPerfiles());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const entrarAPerfil = (id: string): void => {
    fijarPerfilActivo(id);
    setPerfilId(id);
    if (user) void marcarUsoPerfil(user.id, id);
  };

  const salirAPerfil = (): void => {
    fijarPerfilActivo(null);
    setPerfilId(null);
  };

  const cerrarSesion = async (): Promise<void> => {
    fijarPerfilActivo(null);
    setPerfilId(null);
    setPerfiles([]);
    await supabase?.auth.signOut();
    setUser(null);
  };

  /** Primer perfil de la cuenta: lo crea, adopta los datos legado y entra. */
  const completarOnboarding = async (datos: DatosOnboarding): Promise<void> => {
    if (!user) return;
    const p = await crearPrimerPerfil(user.id, {
      nombre: datos.nombre,
      color: datos.color,
      avatar: datos.avatar,
      foto: datos.foto,
      plantillas: datos.plantillas,
    });
    if (!p) return;
    const lista = await cargarPerfiles(user.id);
    setPerfiles(lista);
    entrarAPerfil(p.id);
  };

  if (!authLista || (user && cargandoPerfiles)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted">Cargando…</div>
      </div>
    );
  }

  const perfil = perfiles.find((p) => p.id === perfilId) ?? null;
  const valor: AuthContextValue = {
    user,
    cargando: false,
    sinConexion,
    cerrarSesion,
    perfiles,
    perfilId,
    perfil,
    cargandoPerfiles,
    entrarAPerfil,
    salirAPerfil,
    recargarPerfiles,
  };

  if (!supabase) {
    // Sin Supabase configurado: la app funciona solo en local (desarrollo).
    return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
  }

  if (!user) {
    return (
      <AuthContext.Provider value={valor}>
        <LoginScreen supabase={supabase} />
      </AuthContext.Provider>
    );
  }

  // Sin perfiles: asistente inicial (o selector vacío si lo omitió).
  if (perfiles.length === 0) {
    return (
      <AuthContext.Provider value={valor}>
        {saltoOnboarding ? (
          <SelectorPerfiles />
        ) : (
          <Onboarding onCompletar={completarOnboarding} onOmitir={() => setSaltoOnboarding(true)} />
        )}
      </AuthContext.Provider>
    );
  }

  // Con perfiles pero sin elegir: el selector estilo Netflix.
  if (!perfilId || !perfil) {
    return (
      <AuthContext.Provider value={valor}>
        <SelectorPerfiles />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={valor}>
      {sinConexion && <BannerOffline />}
      {children}
    </AuthContext.Provider>
  );
}

/** Aviso discreto de modo offline: todo se guarda y se sube al volver la red. */
function BannerOffline() {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <IconAlerta className="h-4 w-4 shrink-0" />
      <span>Sin conexión: tus cambios se guardan y se subirán solos.</span>
    </div>
  );
}

function LoginScreen({ supabase }: { supabase: NonNullable<ReturnType<typeof getSupabase>> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message);
      }
    } catch {
      setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Logo className="h-12 w-12" withWordmark />
        </div>
        <h1 className="mb-1 text-center text-2xl font-bold text-foreground">Inicia sesión</h1>
        <p className="mb-6 text-center text-sm text-muted">Una cuenta, varios perfiles: entra y elige quién está ahí.</p>

        {error && (
          <div role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Correo electrónico
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="tucorreo@ejemplo.com"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            <label htmlFor="clave-cuenta">Contraseña</label>
            <CampoClave
              id="clave-cuenta"
              nombre="contraseña"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={enviando}
            className="btn-primary mt-2 min-h-11 disabled:opacity-60"
          >
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
