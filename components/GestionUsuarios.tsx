"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "./AuthGate";
import CampoClave from "./CampoClave";
import { IconPersona, IconPlus, IconCheck } from "../lib/icons";

interface UsuarioListado {
  id: string;
  email: string;
  creado: string;
}

/**
 * Panel de administración de usuarios (estilo Netflix): solo visible para
 * el admin. Crea cuentas (correo + contraseña) vía la Edge Function
 * `crear-usuario` y lista los usuarios existentes.
 */
export default function GestionUsuarios() {
  const { user } = useAuth();
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioListado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creando, setCreando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

  useEffect(() => {
    if (!supabase || !user) return;
    let activo = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("crear-usuario", {
          body: { accion: "es-admin" },
        });
        if (!activo) return;
        if (error || !data?.esAdmin) {
          setEsAdmin(false);
          return;
        }
        setEsAdmin(true);
        setCargando(true);
        const lista = await supabase.functions.invoke("crear-usuario", { body: { accion: "listar" } });
        if (!activo) return;
        if (!lista.error && Array.isArray(lista.data?.usuarios)) {
          setUsuarios(lista.data.usuarios);
        }
      } catch {
        if (activo) setEsAdmin(false);
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, [supabase, user]);

  if (esAdmin !== true) return null;

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || creando) return;
    setError(null);
    setOk(null);
    setCreando(true);
    try {
      const { data, error } = await supabase.functions.invoke("crear-usuario", {
        body: { accion: "crear", email: email.trim(), password, nombre: nombre.trim() },
      });
      if (error) {
        setError("No se pudo crear el usuario. Inténtalo de nuevo.");
      } else if (data?.error) {
        setError(String(data.error));
      } else {
        setOk(`Cuenta creada para ${data.email}. Ya puede iniciar sesión.`);
        setNombre("");
        setEmail("");
        setPassword("");
        const lista = await supabase.functions.invoke("crear-usuario", { body: { accion: "listar" } });
        if (!lista.error && Array.isArray(lista.data?.usuarios)) {
          setUsuarios(lista.data.usuarios);
        }
      }
    } catch {
      setError("No se pudo crear el usuario. Inténtalo de nuevo.");
    } finally {
      setCreando(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5" aria-label="Usuarios">
      <h2 className="flex items-center gap-2 font-semibold">
        <IconPersona className="h-5 w-5 text-accent" />
        Usuarios
      </h2>
      <p className="mt-1 text-sm text-muted">
        Crea cuentas para tu gente: cada persona inicia sesión con su correo y tiene sus propios hábitos.
      </p>

      {cargando ? (
        <p className="mt-4 animate-pulse text-sm text-muted">Cargando usuarios…</p>
      ) : (
        usuarios.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {usuarios.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-2.5"
              >
                <span className="truncate text-sm font-medium">{u.email}</span>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(u.creado).toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )
      )}

      <form onSubmit={crear} className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Crear usuario nuevo</h3>
        {ok && (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
            <IconCheck className="h-4 w-4 shrink-0" />
            {ok}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          Nombre (opcional)
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="input-field"
            placeholder="Ej. María"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          Correo electrónico
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="su-correo@ejemplo.com"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          <label htmlFor="clave-nuevo-usuario">Contraseña (mínimo 8 caracteres)</label>
          <CampoClave
            id="clave-nuevo-usuario"
            nombre="contraseña del nuevo usuario"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            placeholder="••••••••"
          />
        </div>
        <button type="submit" disabled={creando} className="btn-primary min-h-11 disabled:opacity-60">
          <span className="inline-flex items-center gap-2">
            <IconPlus className="h-4 w-4" />
            {creando ? "Creando…" : "Crear usuario"}
          </span>
        </button>
      </form>
    </section>
  );
}
