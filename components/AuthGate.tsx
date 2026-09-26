"use client";

import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getSupabase, getSessionUser } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";
import Logo from "./Logo";

interface AuthContextValue {
  user: User | null;
  cargando: boolean;
  cerrarSesion: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthGate>");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [cargando, setCargando] = useState(() => !!getSupabase());

  const supabase = getSupabase();

  useEffect(() => {
    if (!supabase) return;

    let activo = true;
    getSessionUser().then((u) => {
      if (!activo) return;
      setUser(u);
      setCargando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!activo) return;
      setUser(session?.user ?? null);
      setCargando(false);
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted">Cargando…</div>
      </div>
    );
  }

  const cerrarSesion = async () => {
    await supabase?.auth.signOut();
    setUser(null);
  };

  if (!supabase) {
    // Modo local (sin Supabase configurado): sin autenticación.
    return (
      <AuthContext.Provider value={{ user: null, cargando, cerrarSesion: async () => {} }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (!user) {
    return <LoginScreen supabase={supabase} />;
  }

  return <AuthContext.Provider value={{ user, cargando, cerrarSesion }}>{children}</AuthContext.Provider>;
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
      </div>
    </div>
  );
}
