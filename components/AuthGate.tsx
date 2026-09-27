"use client";

import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getSupabase, getSessionUser } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";
import Logo from "./Logo";
import SelectorPerfiles from "./SelectorPerfiles";
import { logEvent } from "../lib/logger";
import {
  fijarModoAuth,
  fijarPerfilActivo,
  leerModoAuth,
  leerPerfilActivoId,
  leerPerfiles,
  marcarUsoPerfil,
  olvidarModoAuth,
  type ModoAuth,
  type Perfil,
} from "../lib/perfiles";
import { IconCandado, IconPersona } from "../lib/icons";

interface AuthContextValue {
  user: User | null;
  /** Perfil local activo (modo "perfiles"). Excluyente con `user`. */
  perfil: Perfil | null;
  modo: ModoAuth | null;
  cargando: boolean;
  /** En modo cuenta cierra la sesión; en modo perfiles vuelve al selector. */
  cerrarSesion: () => Promise<void>;
  /** Sale por completo y vuelve al menú "¿Cómo quieres entrar?". */
  volverAlMenu: () => Promise<void>;
  entrarAPerfil: (id: string) => void;
  cambiarModo: (modo: ModoAuth) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthGate>");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Modo + perfil activo se leen una sola vez al montar (localStorage síncrono).
  const [modo, setModo] = useState<ModoAuth | null>(() => leerModoAuth());
  const [perfil, setPerfil] = useState<Perfil | null>(() => {
    if (leerModoAuth() !== "perfiles") return null;
    const id = leerPerfilActivoId();
    return id ? leerPerfiles().find((x) => x.id === id) ?? null : null;
  });
  // En modo cuenta la sesión es async: no mostrar el login hasta resolverla.
  const [authLista, setAuthLista] = useState(false);
  const cargando = modo === "cuenta" && !authLista;

  const supabase = getSupabase();

  useEffect(() => {
    if (!supabase || modo !== "cuenta") return;

    let activo = true;
    getSessionUser().then((u) => {
      if (!activo) return;
      setUser(u);
      setAuthLista(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!activo) return;
      setUser(session?.user ?? null);
      setAuthLista(true);
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, modo]);

  useEffect(() => {
    if (!supabase || modo !== "cuenta") return;

    let activo = true;
    getSessionUser().then((u) => {
      if (!activo) return;
      setUser(u);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!activo) return;
      setUser(session?.user ?? null);
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, modo]);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted">Cargando…</div>
      </div>
    );
  }

  const cambiarModo = (m: ModoAuth): void => {
    fijarModoAuth(m);
    logEvent("MODO_CAMBIADO", "perfil", null, { modo: m });
    if (m === "cuenta") {
      fijarPerfilActivo(null);
      setPerfil(null);
    } else {
      const id = leerPerfilActivoId();
      setPerfil(id ? leerPerfiles().find((x) => x.id === id) ?? null : null);
    }
    setModo(m);
  };

  const entrarAPerfil = (id: string): void => {
    const p = leerPerfiles().find((x) => x.id === id);
    if (!p) return;
    fijarPerfilActivo(id);
    marcarUsoPerfil(id);
    logEvent("PERFIL_ACTIVADO", "perfil", id, { nombre: p.nombre });
    setPerfil(p);
  };

  const cerrarSesion = async (): Promise<void> => {
    if (modo === "perfiles") {
      // "Cerrar sesión" en modo perfiles = volver al selector.
      fijarPerfilActivo(null);
      setPerfil(null);
      return;
    }
    await supabase?.auth.signOut();
    setUser(null);
  };

  /** Salir al menú de acceso: cierra la sesión y olvida el modo elegido,
   *  para volver a "¿Cómo quieres entrar?". */
  const volverAlMenu = async (): Promise<void> => {
    if (modo === "cuenta") {
      await supabase?.auth.signOut();
      setUser(null);
    }
    fijarPerfilActivo(null);
    setPerfil(null);
    olvidarModoAuth();
    logEvent("MODO_CAMBIADO", "perfil", null, { modo: "menu" });
    setModo(null);
  };

  const valor: AuthContextValue = { user, perfil, modo, cargando, cerrarSesion, volverAlMenu, entrarAPerfil, cambiarModo };

  if (!supabase) {
    // Modo local (sin Supabase configurado): sin autenticación.
    return (
      <AuthContext.Provider value={valor}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (modo === null) {
    return <ElegirModo onElegir={cambiarModo} />;
  }

  if (modo === "perfiles") {
    if (!perfil) {
      return (
        <AuthContext.Provider value={valor}>
          <SelectorPerfiles />
        </AuthContext.Provider>
      );
    }
    return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
  }

  // Modo cuenta (comportamiento histórico).
  if (!user) {
    return (
      <AuthContext.Provider value={valor}>
        <LoginScreen supabase={supabase} />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

/** Primera pantalla: elegir entre perfiles locales o cuenta en la nube. */
function ElegirModo({ onElegir }: { onElegir: (m: ModoAuth) => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo className="h-14 w-14" withWordmark />
        </div>
        <h1 className="text-center text-2xl font-bold">¿Cómo quieres entrar?</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Puedes cambiarlo cuando quieras. Tus datos están a salvo en cada modo.
        </p>
        <div className="mt-8 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => onElegir("perfiles")}
            className="card flex items-center gap-4 p-5 text-left transition-shadow hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <IconPersona className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-semibold">Perfiles en este dispositivo</span>
              <span className="mt-0.5 block text-sm text-muted">
                Tipo Netflix: cada persona con sus hábitos, sin contraseñas.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onElegir("cuenta")}
            className="card flex items-center gap-4 p-5 text-left transition-shadow hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <IconCandado className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-semibold">Cuenta en la nube</span>
              <span className="mt-0.5 block text-sm text-muted">
                Con correo y clave: tus datos se respaldan y sincronizan.
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ supabase }: { supabase: NonNullable<ReturnType<typeof getSupabase>> }) {
  const { cambiarModo } = useAuth();
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
        <p className="mb-6 text-center text-sm text-muted">Accede para ver tus hábitos.</p>

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
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Contraseña
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </label>
          <button
            type="submit"
            disabled={enviando}
            className="btn-primary mt-2 min-h-11 disabled:opacity-60"
          >
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          Para crear tu cuenta, pídele un enlace de invitación al administrador.
        </p>
        <p className="mt-3 text-center text-xs">
          <button
            type="button"
            onClick={() => cambiarModo("perfiles")}
            className="font-medium text-accent hover:underline"
          >
            O usa perfiles en este dispositivo
          </button>
        </p>
      </div>
    </div>
  );
}
