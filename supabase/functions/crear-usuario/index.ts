// Edge Function crear-usuario — Panel de usuarios estilo Netflix.
//
// Permite al administrador crear cuentas (correo + contraseña) desde la app,
// sin pasar por el dashboard. Seguridad:
//   - verify_jwt=true: solo usuarios autenticados llegan aquí.
//   - Solo los correos en ADMIN_EMAILS pueden crear/listar.
//   - La service_role key vive solo en el entorno de la función.
//
// Acciones (POST JSON):
//   { accion: "es-admin" }                        -> { esAdmin: true }
//   { accion: "listar" }                          -> { usuarios: [{id,email,creado}] }
//   { accion: "crear", email, password, nombre? }  -> { ok, id, email }
//
// Requiere variable de entorno: ADMIN_EMAILS (correos separados por coma).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase solas.
import { createClient } from "npm:@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta variable de entorno requerida: ${name}`);
  return v;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // 1. Identificar al llamante con su propio JWT (verify_jwt ya lo exigió).
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await caller.auth.getUser();
  if (userErr || !user?.email) return json({ error: "No autenticado" }, 401);

  // 2. Solo administradores.
  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return json({ error: "Solo el administrador puede gestionar usuarios" }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = String(body.accion ?? "crear");

  if (accion === "es-admin") return json({ esAdmin: true });

  if (accion === "listar") {
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) return json({ error: error.message }, 500);
    return json({
      usuarios: data.users.map((u) => ({ id: u.id, email: u.email ?? "", creado: u.created_at })),
    });
  }

  if (accion === "crear") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const nombre = String(body.nombre ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "Correo inválido" }, 400);
    }
    if (password.length < 8) {
      return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: nombre || undefined },
    });
    if (error) {
      const yaExiste = /already|existe/i.test(error.message);
      return json({ error: yaExiste ? "Ese correo ya tiene cuenta" : error.message }, 422);
    }
    return json({ ok: true, id: data.user.id, email: data.user.email });
  }

  return json({ error: "Acción desconocida" }, 400);
}

// @ts-expect-error: Deno.serve existe en el runtime de Edge Functions
Deno.serve(handler);
