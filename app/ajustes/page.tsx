"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStoreActions, useStoreState } from "../../lib/habitos/store-context";
import { useAuth } from "../../components/AuthGate";
import { desuscribirPush, notificarAhora, prepararNotificaciones, reproducirSonido, suscribirPush } from "../../lib/habitos/notifications";
import { IconAlerta, IconCampana, IconCerrarSesion, IconDescanso, IconLuna, IconMovimiento, IconPersona, IconSistema, IconSol } from "../../lib/core/ui/icons";
import AvatarPerfil from "../../components/AvatarPerfil";
import GestionHogar from "../../components/GestionHogar";
import GestionRecordatorios from "../../components/GestionRecordatorios";
import { TimeField } from "../../components/core/ui/TimeField";

export default function Ajustes() {
  const { state, errorSync } = useStoreState();
  const { guardarSettings, rehidratar } = useStoreActions();
  const { user, sinConexion, cerrarSesion, perfil, salirAPerfil } = useAuth();
  const settings = state.settings;
  const [notificationMessage, setNotificationMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [mostrarReinicio, setMostrarReinicio] = useState(false);

  // P1.9: el toggle cablea la suscripción web push de verdad — antes solo pedía
  // permiso local y suscribirPush() nunca se invocaba desde la UI.
  async function toggleNotifications(enabled: boolean) {
    setNotificationMessage("");
    if (!enabled) {
      try {
        await desuscribirPush();
      } catch {
        /* la suscripción local se limpia igual */
      }
      guardarSettings({ ...settings, notificaciones: false });
      setNotificationMessage("Recordatorios desactivados.");
      return;
    }
    setBusy(true);
    try {
      await prepararNotificaciones();
      // Registra la suscripción push en el navegador y la persiste en Supabase
      // (con la timezone del dispositivo) para el scheduler.
      await suscribirPush();
      guardarSettings({ ...settings, notificaciones: true });
      setNotificationMessage("Recordatorios activados. Si instalas la app, también los recibirás con la app cerrada.");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "No se pudieron activar las notificaciones.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestNotification() {
    setBusy(true);
    setNotificationMessage("");
    try {
      await prepararNotificaciones();
      await notificarAhora("Notificaciones activas", "Así se verá un recordatorio de tus hábitos.", "habitos-prueba");
      reproducirSonido();
      setNotificationMessage("Prueba enviada. El sonido puede depender de los ajustes de volumen y notificaciones del móvil.");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "No se pudo enviar la prueba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted">Personaliza tu experiencia.</p>
      </header>

      {/* Tema */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <IconLuna className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Apariencia</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3 sm:gap-3">
          {([
            { valor: "claro" as const, etiqueta: "Claro", icon: IconSol },
            { valor: "oscuro" as const, etiqueta: "Oscuro", icon: IconLuna },
            { valor: "sistema" as const, etiqueta: "Sistema", icon: IconSistema },
          ]).map((opcion) => {
            const activo = settings.tema === opcion.valor;
            return (
              <button
                key={opcion.valor}
                type="button"
                aria-pressed={activo}
                onClick={() => guardarSettings({ ...settings, tema: opcion.valor })}
                className={`flex min-h-12 flex-row items-center justify-center gap-2 rounded-xl border-2 p-3 transition-all min-[380px]:min-h-24 min-[380px]:flex-col min-[380px]:p-4 ${
                  activo
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <opcion.icon className={`h-6 w-6 ${activo ? "text-accent" : "text-muted"}`} />
                <span className={`text-sm font-medium capitalize ${activo ? "text-accent" : "text-muted"}`}>
                  {opcion.etiqueta}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Sincronización — A1: errorSync antes era invisible; ahora la UI
          muestra si algo no se pudo subir a la nube y permite reintentar. */}
      <section className="card p-4 sm:p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${errorSync ? "bg-amber-500" : "bg-emerald-500"}`}
            />
            <div className="min-w-0">
              <h2 className="font-semibold">Sincronización</h2>
              <p className="text-sm text-muted">
                {errorSync
                  ? `No se pudo sincronizar: ${errorSync}. Tus cambios están guardados en este dispositivo.`
                  : "Todo sincronizado con la nube."}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={reintentando}
            onClick={async () => {
              setReintentando(true);
              try {
                await rehidratar();
              } finally {
                setReintentando(false);
              }
            }}
            className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
          >
            {reintentando ? "Sincronizando…" : "Reintentar"}
          </button>
        </div>
      </section>

      {/* Reducir movimiento */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:flex-nowrap sm:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <IconMovimiento className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">Reducir movimiento</h2>
            <p className="text-sm text-muted">Atenúa animaciones y transiciones.</p>
          </div>
        </div>
        <Switch
          checked={settings.reducirMovimiento}
          onChange={(v) => guardarSettings({ ...settings, reducirMovimiento: v })}
        />
      </section>

      {/* Notificaciones */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            <IconCampana className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <h2 className="font-semibold">Notificaciones</h2>
              <p className="text-sm text-muted">Recordatorios de hábitos en sus horarios, salvo durante el descanso.</p>
            </div>
          </div>
          <Switch checked={settings.notificaciones} onChange={toggleNotifications} />
        </div>
        {settings.notificaciones && (
          <button type="button" disabled={busy} onClick={sendTestNotification} className="mt-3 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50 sm:w-auto">
            {busy ? "Enviando…" : "Probar notificación y sonido"}
          </button>
        )}
        {notificationMessage && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">{notificationMessage}</p>}
        <p className="mt-3 text-xs text-muted">En la web, los horarios se revisan cuando la app está abierta; para recibirlos con la app cerrada hace falta configurar notificaciones push con un servidor.</p>
      </section>

      {/* Horas de descanso */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <IconDescanso className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">Horas de descanso</h2>
            <p className="text-sm text-muted">Ventana sin recordatorios de hábitos.</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-[380px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Inicio</span>
            <TimeField
              value={settings.horasDescanso.inicio}
              onChange={(inicio) =>
                guardarSettings({
                  ...settings,
                  horasDescanso: { ...settings.horasDescanso, inicio },
                })
              }
              ariaLabel="Hora de inicio del descanso"
              className="input-field"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Fin</span>
            <TimeField
              value={settings.horasDescanso.fin}
              onChange={(fin) =>
                guardarSettings({
                  ...settings,
                  horasDescanso: { ...settings.horasDescanso, fin },
                })
              }
              ariaLabel="Hora de fin del descanso"
              className="input-field"
            />
          </div>
        </div>
      </section>

      {/* Perfil activo: quién está usando la app ahora. */}
      <section className="card p-4 sm:p-5" aria-label="Perfil activo">
        <h2 className="font-semibold">Perfil</h2>
        <div className="mt-4 flex items-center gap-3">
          {perfil ? (
            <AvatarPerfil perfil={perfil} className="h-11 w-11 text-lg" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <IconPersona className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{perfil?.nombre ?? "Sin perfil"}</p>
            <p className="text-sm text-muted">Sus hábitos y progreso se guardan en la nube, separados de los demás.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={salirAPerfil}
          className="btn-secondary mt-4 min-h-11 w-full"
        >
          Cambiar de perfil
        </button>
      </section>

      {/* Cuenta: identidad única offline-first. */}
      <section className="card p-4 sm:p-5" aria-label="Cuenta">
        <h2 className="font-semibold">Cuenta</h2>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconPersona className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{user?.email ?? "Cuenta local"}</p>
            <p className="text-sm text-muted">
              {sinConexion
                ? "Sin conexión: tus cambios se guardan y se subirán solos."
                : "Tus datos se sincronizan entre tus aparatos."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void cerrarSesion()}
          className="btn-secondary mt-4 min-h-11 w-full"
        >
          <span className="inline-flex items-center gap-2">
            <IconCerrarSesion className="h-4 w-4" />
            Cerrar sesión
          </span>
        </button>
      </section>

      {/* Hogar: datos compartidos de Senda (Fase 0). */}
      <GestionHogar />

      {/* Recordatorios genéricos (Fase 0.5). */}
      <GestionRecordatorios />

      {/* Zona de peligro */}
      <section className="card border-red-500/30 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <IconAlerta className="h-5 w-5 shrink-0 text-red-500" />
          <div>
            <h2 className="font-semibold text-red-500">Zona de peligro</h2>
            <p className="text-sm text-muted">Borra todos tus datos y empieza desde cero.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMostrarReinicio(true)}
          className="mt-3 min-h-11 w-full rounded-xl border border-red-500/50 px-4 text-sm font-semibold text-red-500 hover:bg-red-500/10 sm:w-auto"
        >
          Reiniciar la app
        </button>
      </section>

      {mostrarReinicio && <ModalReinicio onCerrar={() => setMostrarReinicio(false)} />}
    </div>
  );
}

/** Confirmación propia (nada de confirm() nativo) para reiniciar la app. */
function ModalReinicio({ onCerrar }: { onCerrar: () => void }) {
  const { reiniciarTodo } = useStoreActions();
  const router = useRouter();
  const [armado, setArmado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  async function ejecutar() {
    // Doble toque: el primero arma, el segundo ejecuta.
    if (!armado) {
      setArmado(true);
      return;
    }
    setBorrando(true);
    setError("");
    try {
      await reiniciarTodo();
      onCerrar();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reiniciar la app.");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reinicio-titulo"
        className="card w-full max-w-sm p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <IconAlerta className="h-6 w-6 shrink-0 text-red-500" />
          <div>
            <h2 id="reinicio-titulo" className="text-lg font-bold">
              ¿Empezar desde cero?
            </h2>
            <p className="mt-1 text-sm text-muted">
              Se borrarán tus hábitos, registros, rachas, XP, logros y desafíos, en este dispositivo
              y en la nube. Esta acción no se puede deshacer.
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => {
              setArmado(false);
              onCerrar();
            }}
            disabled={borrando}
            className="min-h-11 flex-1 rounded-xl border border-border px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={ejecutar}
            disabled={borrando}
            className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50 ${
              armado ? "bg-red-600 hover:bg-red-700" : "bg-red-500/90 hover:bg-red-600"
            }`}
          >
            {borrando ? "Borrando…" : armado ? "Toca de nuevo para confirmar" : "Borrar todo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="switch-track shrink-0"
      data-checked={checked ? "true" : "false"}
    >
      <span className="switch-thumb" />
    </button>
  );
}
