'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { startOfWeekMonday, addDays, toISODate } from '@/lib/date';
import Image from 'next/image';
import Link from 'next/link';
import { useSwipeable } from 'react-swipeable';

// Tipos flexibles SOLO para el entorno /test
type RowKey = string;
type ProcKey = string;
type ProcDef = { name: string; color_bg?: string | null; color_text?: string | null };

import {
  listWeek,
  addItem,
  updateItem,
  deleteItem,
  subscribeItems,
  getMyRole,
} from '@/lib/data';

// Tipo Item flexible para /test (evita depender de ROWS/PROCS estáticos)
import type { Item as DbItem } from '@/lib/data';
type Item = DbItem;

// Ingresados (tabla inpatients)
type InpatientRow = {
  id: string;
  center_id: string;
  source_item_id: string;
  name: string | null;
  bed: string | null;
  dx: string | null;
  evolution: string | null;
  is_active: boolean;
  admitted_at: string;
  discharged_at: string | null;
};

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Calendar,
  ChevronsUp,
  ChevronsDown,
  Save,
  X,
  Pencil,
  Download,
  CheckCircle2,
  Circle,
  BedDouble,
  Loader2,
} from 'lucide-react';

/* ===== helpers (UNA sola vez) ===== */

export async function retry<T>(fn: () => Promise<T>, tries = 6, baseMs = 400): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = baseMs * Math.pow(1.6, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

let lastNetWarnAt = 0;

export function isTransientNetworkError(e: any) {
  const raw =
    e?.message ??
    e?.error_description ??
    e?.details ??
    e?.hint ??
    (typeof e === 'string' ? e : '');

  const msg = String(raw).toLowerCase();
  const offline = typeof navigator !== 'undefined' ? navigator.onLine === false : false;

  return (
    offline ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    msg.includes('err_network_changed') ||
    msg.includes('internet_disconnected') ||
    msg.includes('websocket') ||
    msg.includes('timeout') ||
    // abort / cancelled requests (Safari/Chrome can surface as "signal is aborted")
    msg.includes('abort') ||
    msg.includes('aborted') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted')
  );
}

export function showErr(e: any) {
  const now = Date.now();

  if (isTransientNetworkError(e)) {
    if (now - lastNetWarnAt > 5000) {
      console.warn('[NET] transient error — ignoring alert', e);
      lastNetWarnAt = now;
    }
    return;
  }

  console.error('[ERR]', e);

  const msg =
    String(e?.message || e?.error_description || e?.details || e?.hint || '').trim() ||
    'Error inesperado. Revisa la consola.';

  alert(msg);
}

/* ===== UI: editor inline ===== */

function InlineEditorCard({
  title = 'Nuevo paciente',
  initial = { name: '', room: '', dx: '', proc: 'Coronaria' as ProcKey },
  procs,
  onSave,
  onCancel,
}: {
  title?: string;
  initial?: { name: string; room: string; dx: string; proc: string };
  procs: ProcDef[];
  onSave: (vals: { name: string; room: string; dx: string; proc: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [room, setRoom] = useState(initial.room);
  const [dx, setDx] = useState(initial.dx);
  const [proc, setProc] = useState<string>(initial.proc);

  return (
    <div className="bg-white rounded-xl border p-3 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-1">
          <button className="p-1 rounded hover:bg-gray-100" title="Cancelar" onClick={onCancel}>
            <X className="w-4 h-4" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-100"
            title="Guardar"
            onClick={() => onSave({ name, room, dx, proc })}
          >
            <Save className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
  <label className="text-xs text-gray-600">
    ID -evitar nombre completo-
    <input
      className="mt-1 w-full border rounded-lg px-2 py-2 text-sm"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Paciente"
    />
  </label>

  <label className="text-xs text-gray-600">
    Diagnóstico
    <input
      className="mt-1 w-full border rounded-lg px-2 py-2 text-sm"
      value={dx}
      onChange={(e) => setDx(e.target.value)}
      placeholder="Motivo / Dx"
    />
  </label>

  <label className="text-xs text-gray-600">
    Habitación
    <input
      className="mt-1 w-full border rounded-lg px-2 py-2 text-sm"
      value={room}
      onChange={(e) => setRoom(e.target.value)}
      placeholder="Habitación, cama, etc."
    />
  </label>

  <label className="text-xs text-gray-600">
    Procedimiento
    <select
      className="mt-1 w-full border rounded-lg px-2 py-2 text-sm bg-white"
      value={proc}
      onChange={(e) => setProc(e.target.value as ProcKey)}
    >
      {procs.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  </label>
</div>
    </div>
  );
}

/* ===== raíz cliente (/test) ===== */
export default function PageClientBoard({ slug }: { slug?: string }) {
  // slug robusto: si no llega por props, lo inferimos del pathname (/test -> "test")
  const centerSlug = useMemo(() => {
    const fromProps = typeof slug === 'string' ? slug.trim() : '';
    if (fromProps) return fromProps.toLowerCase();

    if (typeof window === 'undefined') return '';
    const parts = window.location.pathname.split('/').filter(Boolean);
    const fromPath = (parts[0] || '').trim();
    return fromPath ? fromPath.toLowerCase() : '';
  }, [slug]);
  

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<'editor' | 'viewer' | 'unknown'>('unknown');

  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerName, setCenterName] = useState<string>('SalaTrack');  
  const [rows, setRows] = useState<RowKey[]>([]);
  const [procs, setProcs] = useState<ProcDef[]>([]);
  const [openRoomsToday, setOpenRoomsToday] = useState<number | null>(null);
  // Evita cargas solapadas del centro (single-flight)
  const loadingCenterRef = useRef<Promise<void> | null>(null);

  // ─────────────────────────────────────────────────────────────
  // 1) Cargar configuración del centro
  // ─────────────────────────────────────────────────────────────
  const loadCenterConfig = useCallback(async () => {
    // Single-flight: evita llamadas solapadas (p.ej. StrictMode / doble render)
    if (loadingCenterRef.current) return loadingCenterRef.current;

    const p = (async () => {
      // NOTE: usamos limit(1)+maybeSingle() para evitar errores si hay 0 o >1 centros con el mismo slug
      const { data: center, error: cErr } = await supabase
        .from('centers')
        .select('id, slug, name')
        .eq('slug', centerSlug)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cErr) throw cErr;
      if (!center?.id) throw new Error(`Centro no encontrado: ${centerSlug || '(slug vacío)'}`);

      setCenterId(center.id);
      setCenterName(center.name || centerSlug);

      // Rooms (filas)
      const { data: roomsData, error: rErr } = await supabase
        .from('rooms')
        .select('name, active')
        .eq('center_id', center.id)
        .eq('active', true)
        .order('name', { ascending: true });

      if (rErr) throw rErr;

      const roomNames: string[] = (roomsData ?? [])
        .map((x: any) => String(x.name))
        .filter(Boolean);

      setRows(roomNames.length ? roomNames : ['Sala 1']);

      // Procedures
      const { data: procData, error: pErr } = await supabase
        .from('procedure_types')
        .select('name, color_bg, color_text, sort_order, active')
        .eq('center_id', center.id)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (pErr) throw pErr;

      const procList: ProcDef[] = (procData ?? [])
        .map((x: any) => ({
          name: String(x.name),
          color_bg: x.color_bg ?? null,
          color_text: x.color_text ?? null,
        }))
        .filter((p) => p.name);

      setProcs(
        procList.length
          ? procList
          : [{ name: 'Coronario', color_bg: '#DCFCE7', color_text: '#166534' }],
      );

      // Salas abiertas hoy (room_schedule)
      const todayISO = toISODate(new Date());
      const { data: sched, error: sErr } = await supabase
        .from('room_schedule')
        .select('open_rooms')
        .eq('center_id', center.id)
        .eq('day', todayISO)
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sErr) throw sErr;

      const open = sched?.open_rooms ?? roomNames.length ?? null;
      setOpenRoomsToday(typeof open === 'number' ? open : null);
    })();

    loadingCenterRef.current = p;
    try {
      await p;
    } finally {
      // libera el lock aunque haya error
      loadingCenterRef.current = null;
    }
  }, [centerSlug]);

  // ─────────────────────────────────────────────────────────────
  // 1b) Cargar configuración del centro SIEMPRE (aunque no haya login)
  //     (un solo disparo; sin watchdog ni hard-retries)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await loadCenterConfig();
      } catch (e) {
        if (cancelled) return;
        // Abort/transient: no bloqueamos la UI ni alertamos
        if (isTransientNetworkError(e)) {
          console.warn('[CENTER] transient error loading config (ignored)', e);
          return;
        }
        showErr(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCenterConfig]);
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
// 2) Auth bootstrap + listener (NO bloqueante + timeout)
// ─────────────────────────────────────────────────────────────
useEffect(() => {
  let alive = true;

  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    let t: any;
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`Timeout: ${label}`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(t);
    }
  };

  // Mejorada: trata errores transitorios de forma silenciosa, timeout solo local, fallback viewer
  const resolveRole = async (sess: any) => {
    const hasUser = !!sess?.user;
    if (!hasUser) return 'unknown' as const;

    try {
      // Timeout solo para el rol (no para el resto del boot)
      const r = await withTimeout(getMyRole(centerSlug), 4000, 'getMyRole');
      return r;
    } catch (e) {
      // Si es transitorio/abort/timeout, no asustes: caemos a viewer y reintentamos en background
      if (isTransientNetworkError(e)) {
        console.warn('[AUTH] getMyRole transient/timeout -> viewer (will retry)', e);
      } else {
        console.warn('[AUTH] getMyRole failed -> viewer (will retry)', e);
      }
      return 'viewer' as const;
    }
  };

  // Si el role cae a viewer por timeout/transitorio, intentamos “subir” a editor en background
  // (sin bloquear UI) y sin solapar reintentos.
  let upgrading: Promise<void> | null = null;

  const upgradeToEditor = async (sess: any) => {
    if (!sess?.user) return;
    if (upgrading) return upgrading;

    upgrading = (async () => {
      const maxTries = 6;
      for (let i = 0; i < maxTries && alive; i++) {
        // espera fija (evita martillar) + un pequeño jitter
        const waitMs = 2200 + Math.floor(Math.random() * 600);
        await new Promise((r) => setTimeout(r, waitMs));
        if (!alive) return;

        try {
          const r2 = await resolveRole(sess);
          if (!alive) return;
          if (r2 === 'editor') {
            console.log('[AUTH] role upgraded to editor on retry');
            setRole('editor');
            return;
          }
        } catch {
          // ignoramos y seguimos intentando
        }
      }
    })().finally(() => {
      upgrading = null;
    });

    return upgrading;
  };

  // Listener SIEMPRE activo
  const { data: listener } = supabase.auth.onAuthStateChange(async (_event, sess) => {
    if (!alive) return;

    console.log('[AUTH] onAuthStateChange user =', !!sess?.user);

    // ✅ NO bloquees la UI esperando nada
    setAuthReady(true);

    // Optimista: si hay usuario, al menos viewer mientras resolvemos
    setRole(sess?.user ? 'viewer' : 'unknown');

    // Luego intentamos resolver el rol real con timeout
    const nextRole = await resolveRole(sess);
    if (!alive) return;
    setRole(nextRole);

    // ✅ Retry upgrade si hay usuario pero nos quedamos en viewer (típico tras timeouts/transitorios)
    if (sess?.user && nextRole === 'viewer') {
      void upgradeToEditor(sess);
    }
  });

  // Bootstrap inicial
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      console.log('[AUTH] mount session user =', !!data.session?.user);

      // ✅ UI lista ya
      setAuthReady(true);

      // Optimista
      setRole(data.session?.user ? 'viewer' : 'unknown');

      // Rol real (con timeout)
      const nextRole = await resolveRole(data.session);
      if (!alive) return;
      setRole(nextRole);

      // ✅ Retry upgrade también en el boot (por si entramos con sesión ya guardada)
      if (data.session?.user && nextRole === 'viewer') {
        void upgradeToEditor(data.session);
      }
    } catch (e) {
      console.warn('[AUTH] boot failed -> unknown', e);
      if (!alive) return;
      setRole('unknown');
      setAuthReady(true);
    }
  })();

  return () => {
    alive = false;
    listener.subscription.unsubscribe();
  };
}, [centerSlug]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-[1600px] mx-auto">
      <Header role={role} centerName={centerName} openRoomsToday={openRoomsToday} />
      {!authReady ? (
        <div className="text-sm text-gray-600">Cargando…</div>
      ) : role === 'unknown' ? (
        <div className="text-sm text-gray-600">
          Inicia sesión para editar. (Modo lectura si no tienes permisos)
        </div>
      ) : centerId ? (
        <Board role={role} rows={rows} procs={procs} centerId={centerId} />
      ) : (
        <div className="text-sm text-gray-600">Cargando centro…</div>
      )}
    </div>
  );
}

/* ===== cabecera / auth ===== */

function Header({
  role,
  centerName,
  openRoomsToday,
}: {
  role: 'editor' | 'viewer' | 'unknown';
  centerName: string;
  openRoomsToday: number | null;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      {/* IZQUIERDA */}
      <div className="flex items-center gap-4 min-w-0">
        <Link
          href="https://www.salatrack.app"
          target="_blank"
          rel="noopener noreferrer"
          title="Ir a SalaTrack"
          className="shrink-0"
        >
          <Image
            src="/salatrack-logo.svg"
            alt="SalaTrack"
            width={32}
            height={32}
            className="cursor-pointer hover:opacity-90 transition-opacity"
            priority
          />
        </Link>

        <div className="flex flex-col min-w-0">
          <div className="text-xl font-semibold leading-tight text-gray-900 dark:text-gray-100 truncate">
            {centerName || '…'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-300">
            {openRoomsToday == null ? 'Salas disponibles: —' : `Salas disponibles: ${openRoomsToday}`}
          </div>
        </div>
      </div>

      {/* DERECHA: badge + auth, SIEMPRE en la misma fila */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span
          className="
            text-sm px-2 py-1 rounded-full border
            bg-white text-gray-700 border-gray-300
            dark:bg-gray-900 dark:text-gray-200 dark:border-gray-600
          "
        >
          {role === 'editor' ? 'Editor' : role === 'viewer' ? 'Solo lectura' : 'No autenticado'}
        </span>

        <AuthButtons />
      </div>
    </div>
  );
}

/* ===== auth UI ===== */

function AuthButtons() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // ✅ modal login (solo móvil)
  const [open, setOpen] = useState(false);

  // ✅ reset password
  const [resetSent, setResetSent] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setUserEmail(data.session?.user?.email ?? null);
      } catch (e) {
        if (isTransientNetworkError(e)) return;
        console.warn('[AUTH] getSession failed', e);
      }
    })();

    const sub = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setUserEmail(sess?.user?.email ?? null);
    });

    return () => sub.data.subscription.unsubscribe();
  }, []);

  // ✅ Detecta si venimos del link de recuperación (Supabase añade type=recovery)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const type = url.searchParams.get('type');
    setRecoveryMode(type === 'recovery');
  }, []);

  const signIn = async () => {
    try {
      if (!email || !pass) {
        alert('Introduce email y contraseña');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });
      if (error) throw error;

      setEmail('');
      setPass('');
      setOpen(false);

      // Aviso opcional para otros componentes
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('salatrack:signedin'));
      }
    } catch (e) {
      showErr(e);
    }
  };

  const signOut = async () => {
    try {
      localStorage.removeItem('salatrack_readonly');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // ✅ actualiza UI inmediatamente
      setUserEmail(null);
      setOpen(false);
      setEmail('');
      setPass('');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('salatrack:signedout'));
      }
    } catch (e) {
      showErr(e);
    }
  };

  // ✅ envía email de reset
  const sendResetEmail = async () => {
    try {
      if (!email) {
        alert('Introduce tu email para enviarte el enlace de recuperación');
        return;
      }
      setResetSent(false);

      const redirectTo =
      typeof window !== "undefined"
       ? `${window.location.origin}/reset-password`
       : undefined;

        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
       if (error) throw error;

      setResetSent(true);
    } catch (e) {
      showErr(e);
    }
  };

  // ✅ guarda nueva contraseña (modo recovery)
  const updatePassword = async () => {
    try {
      if (!newPass || newPass.length < 8) {
        alert('La contraseña debe tener al menos 8 caracteres');
        return;
      }
      if (newPass !== newPass2) {
        alert('Las contraseñas no coinciden');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;

      setNewPass('');
      setNewPass2('');
      setRecoveryMode(false);

      // Cierra modal (por si estás en móvil)
      setOpen(false);

      // Limpia URL (quita ?type=recovery...)
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
        window.dispatchEvent(new Event('salatrack:signedin'));
      }

      alert('Contraseña actualizada. Ya puedes iniciar sesión.');
    } catch (e) {
      showErr(e);
    }
  };

  // ─────────────────────────────────────────────
  // Usuario autenticado (SIN opción extra)
  // ─────────────────────────────────────────────
  if (userEmail) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-300 hidden sm:inline">
          {userEmail}
        </span>

        <button
          className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                     dark:border-gray-600 dark:text-gray-100"
          onClick={signOut}
        >
          Salir
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Helpers UI (mantenemos el estilo)
  // ─────────────────────────────────────────────
  const LinkReset = (
    <button
      type="button"
      onClick={() => void sendResetEmail()}
      className="text-[11px] text-gray-500 hover:underline dark:text-gray-300 text-left"
      title="Enviar enlace de recuperación"
    >
      ¿Olvidaste la contraseña?
    </button>
  );

  const ResetSentBadge = resetSent ? (
    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
      Enlace enviado ✅ Revisa tu correo
    </div>
  ) : null;

  // ─────────────────────────────────────────────
  // NO autenticado
  // Desktop: inline
  // Móvil: botón + modal
  // + recovery mode (si type=recovery)
  // ─────────────────────────────────────────────
  return (
    <>
      {/* DESKTOP (>= sm) */}
      {!recoveryMode ? (
        <div className="hidden sm:flex flex-col items-end gap-1">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <input
              className="w-[180px] border rounded-lg px-2 py-1 text-sm
                         dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              className="w-[140px] border rounded-lg px-2 py-1 text-sm
                         dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
              placeholder="password"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="submit"
              className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                         dark:border-gray-600 dark:text-gray-100"
            >
              Entrar
            </button>
          </form>

          {/* Link reset + confirmación */}
          <div className="flex flex-col items-end gap-1">
            {LinkReset}
            {ResetSentBadge}
          </div>
        </div>
      ) : (
        // DESKTOP recovery: mini form de nueva contraseña (sin cambiar demasiado el look)
        <div className="hidden sm:flex flex-col items-end gap-2">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Establecer nueva contraseña
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void updatePassword();
            }}
          >
            <input
              className="w-[180px] border rounded-lg px-2 py-1 text-sm
                         dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
              placeholder="Nueva contraseña"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
            />
            <input
              className="w-[180px] border rounded-lg px-2 py-1 text-sm
                         dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
              placeholder="Repetir contraseña"
              type="password"
              value={newPass2}
              onChange={(e) => setNewPass2(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="submit"
              className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                         dark:border-gray-600 dark:text-gray-100"
            >
              Guardar
            </button>
          </form>
        </div>
      )}

      {/* MÓVIL (< sm): botón compacto */}
      <div className="sm:hidden">
        <button
          className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                     dark:border-gray-600 dark:text-gray-100"
          onClick={() => setOpen(true)}
        >
          Entrar
        </button>
      </div>

      {/* MODAL móvil */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* overlay */}
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            type="button"
          />

          {/* panel */}
          <div
            className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2
                       rounded-2xl border bg-white p-4 shadow-xl
                       dark:bg-gray-950 dark:border-gray-700"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm dark:text-gray-100">
                {recoveryMode ? 'Nueva contraseña' : 'Iniciar sesión'}
              </div>
              <button
                className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                           dark:border-gray-600 dark:text-gray-100"
                onClick={() => setOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            {!recoveryMode ? (
              <>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void signIn();
                  }}
                >
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm
                               dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                  />
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm
                               dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
                    placeholder="password"
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="submit"
                    className="mt-1 w-full px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                               dark:border-gray-600 dark:text-gray-100"
                  >
                    Entrar
                  </button>
                </form>

                <div className="mt-2 flex flex-col gap-1">
                  {LinkReset}
                  {ResetSentBadge}
                </div>
              </>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void updatePassword();
                }}
              >
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm
                             dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
                  placeholder="Nueva contraseña"
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm
                             dark:bg-gray-900 dark:text-gray-100 dark:border-gray-600"
                  placeholder="Repetir contraseña"
                  type="password"
                  value={newPass2}
                  onChange={(e) => setNewPass2(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="submit"
                  className="mt-1 w-full px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                             dark:border-gray-600 dark:text-gray-100"
                >
                  Guardar contraseña
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatDateES(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function formatShortES(isoLike?: string | null) {
  if (!isoLike) return '';
  const iso = String(isoLike);
  const ymd = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}`;
}
/* ===== tablero ===== */

function Board({
  role,
  rows,
  procs,
  centerId,
}: {
  role: 'editor' | 'viewer';
  rows: RowKey[];
  procs: ProcDef[];
  centerId: string | null;
}) {
const [weekStart, setWeekStart] = useState<Date>(() => {
  // Arranque inteligente:
  // - Entre semana: lunes de la semana actual
  // - Sábado/Domingo: lunes de la semana que entra
  // (getActiveDayISO ya ajusta fin de semana -> lunes)
  const activeIso = getActiveDayISO();
  return startOfWeekMonday(new Date(`${activeIso}T12:00:00`));
});
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');

  // ─────────────────────────────────────────────
// Ingresados
// ─────────────────────────────────────────────
const [inpatientsOpen, setInpatientsOpen] = useState(false);
const [inpatients, setInpatients] = useState<InpatientRow[]>([]);
const [inpatientsLoading, setInpatientsLoading] = useState(false);
const [inpatientSet, setInpatientSet] = useState<Set<string>>(new Set()); // source_item_id
const [inpatientMetaMap, setInpatientMetaMap] = useState<Record<string, { proc: string; day: string }>>({});
const saveTimersRef = useRef<Record<string, any>>({});

const inpatientInFlightRef = useRef<Set<string>>(new Set());

const refreshInpatients = useCallback(async () => {
  if (!centerId) return;
  setInpatientsLoading(true);
  try {
    const { data, error } = await supabase
      .from('inpatients')
      .select('*')
      .eq('center_id', centerId)
      .eq('is_active', true)
      .order('admitted_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as InpatientRow[];
    setInpatients(rows);
    const ids = rows.map((r) => r.source_item_id).filter(Boolean);
    setInpatientSet(new Set(ids));

    // Proc + fecha (items.day) "copiados" desde la pizarra: puede no estar en la semana visible, así que lo pedimos por id
    if (ids.length) {
      try {
        const { data: itData, error: itErr } = await supabase
          .from('items')
          .select('id, proc, day')
          .in('id', ids);
        if (itErr) throw itErr;

        const map: Record<string, { proc: string; day: string }> = {};
        for (const x of itData ?? []) {
          if (!(x as any)?.id) continue;
          map[String((x as any).id)] = {
            proc: String((x as any).proc ?? ''),
            day: String((x as any).day ?? ''),
          };
        }
        setInpatientMetaMap(map);
      } catch (e) {
        console.warn('[INP] proc/day lookup failed', e);
        setInpatientMetaMap({});
      }
    } else {
      setInpatientMetaMap({});
    }
  } catch (e) {
    console.warn('[INP] refresh failed', e);
  } finally {
    setInpatientsLoading(false);
  }
}, [centerId]);

useEffect(() => {
  // Mantener inpatientSet sincronizado siempre (para que viewers vean la cama verde)
  if (!centerId) return;
  void refreshInpatients();
}, [centerId, refreshInpatients]);

useEffect(() => {
  if (!inpatientsOpen) return;
  void refreshInpatients();
}, [inpatientsOpen, refreshInpatients]);

const toggleInpatient = useCallback(
  async (it: Item) => {
    if (!centerId) return;

    // evita doble-click / llamadas solapadas
    const key = String(it.id);
    if (inpatientInFlightRef.current.has(key)) return;
    inpatientInFlightRef.current.add(key);

    try {
      const isIn = inpatientSet.has(it.id);

      if (isIn) {
        // Dar de alta: desactivar
        const { error } = await supabase
          .from('inpatients')
          .update({ is_active: false, discharged_at: new Date().toISOString() })
          .eq('center_id', centerId)
          .eq('source_item_id', it.id)
          .eq('is_active', true);

        if (error) throw error;

        // Optimista
        setInpatientSet((prev) => {
          const n = new Set(prev);
          n.delete(it.id);
          return n;
        });
        setInpatients((prev) => prev.filter((r) => r.source_item_id !== it.id));

        // Sync
        void refreshInpatients();
        return;
      }

      // Ingresar: insertar
      const payload = {
        center_id: centerId,
        source_item_id: it.id,
        name: it.name ?? null,
        bed: it.room ?? null,
        dx: it.dx ?? null,
        evolution: null,
        is_active: true,
        admitted_at: new Date().toISOString(),
        discharged_at: null,
      };

      // IMPORTANTÍSIMO: NO uses .select().single() aquí
      const { error: insErr } = await supabase.from('inpatients').insert(payload);

      if (insErr) {
        const code = (insErr as any).code;
        // 23505 / 409 Conflict => ya existía activo (carrera / estado desincronizado). Lo tratamos como OK.
        if (code !== '23505') throw insErr;
      }

      // Optimista
      setInpatientSet((prev) => {
        const n = new Set(prev);
        n.add(it.id);
        return n;
      });

      // Sync (para que el modal liste bien)
      await refreshInpatients();
    } catch (e) {
      console.warn('[INP] toggle failed', e);
    } finally {
      inpatientInFlightRef.current.delete(String(it.id));
    }
  },
  [centerId, inpatientSet, refreshInpatients]
);

const updateInpatientFieldDebounced = useCallback(
  (rowId: string, patch: Partial<InpatientRow>) => {
    // Optimista en UI
    setInpatients((prev) =>
      prev.map((r) => (r.id === rowId ? ({ ...r, ...patch } as InpatientRow) : r))
    );

    const timers = saveTimersRef.current;
    if (timers[rowId]) clearTimeout(timers[rowId]);

    timers[rowId] = setTimeout(async () => {
      try {
        const { error } = await supabase.from('inpatients').update(patch).eq('id', rowId);
        if (error) throw error;
      } catch (e) {
        console.warn('[INP] update failed', e);
      }
    }, 700);
  },
  []
);

const dischargeInpatient = useCallback(
  async (rowId: string) => {
    try {
      const row = inpatients.find((r) => r.id === rowId);

      const { error } = await supabase
        .from('inpatients')
        .update({ is_active: false, discharged_at: new Date().toISOString() })
        .eq('id', rowId);

      if (error) throw error;

      setInpatients((prev) => prev.filter((r) => r.id !== rowId));

      if (row?.source_item_id) {
        setInpatientSet((prev) => {
          const n = new Set(prev);
          n.delete(row.source_item_id);
          return n;
        });
      }
    } catch (e) {
      console.warn('[INP] discharge failed', e);
    }
  },
  [inpatients]
);

  const [draftCell, setDraftCell] = useState<{ day: string; row: RowKey } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const [readOnly, setReadOnly] = useState<boolean>(() => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('salatrack_readonly') === '1';
});
useEffect(() => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('salatrack_readonly', readOnly ? '1' : '0');
}, [readOnly]);

// Filtro de sala
// Filtro de sala (persistido)
const [roomFilter, setRoomFilter] = useState<RowKey>(() => {
  if (typeof window === 'undefined') return '__all__';
  return (localStorage.getItem('salatrack_roomfilter') as RowKey) || '__all__';
});

useEffect(() => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('salatrack_roomfilter', String(roomFilter));
}, [roomFilter]);

const visibleRows = useMemo(() => {
  if (roomFilter === '__all__') return rows;
  return rows.filter((r) => r === roomFilter);
}, [rows, roomFilter]);

// rol efectivo: si editor + readOnly => se comporta como viewer
const effectiveRole = (role === "editor" && readOnly) ? "viewer" : role;
const isEditorUser = role === 'editor';

// Semana (L-V) en ISO (semana visible)
const dayKeys = useMemo(() => {
  const days: string[] = [];
  for (let i = 0; i < 5; i++) days.push(toISODate(addDays(weekStart, i)));
  return days;
}, [weekStart]);

// ✅ HOY real (con ajuste fin de semana). Úsalo SOLO para resaltar
const todayKey = getActiveDayISO();

// ✅ Día activo SELECCIONABLE (necesita ser state para que las flechas funcionen día a día)
const clampToWeek = useCallback(
  (iso: string) => {
    if (iso < dayKeys[0]) return dayKeys[0];
    if (iso > dayKeys[4]) return dayKeys[4];
    return iso;
  },
  [dayKeys]
);

const [activeDayKey, setActiveDayKey] = useState<string>(() => {
  // inicial: hoy ajustado, pero si cae fuera del rango L-V de la semana visible → lunes
  const today = getActiveDayISO();
  return today >= dayKeys[0] && today <= dayKeys[4] ? today : dayKeys[0];
});
function addDaysISO(iso: string, delta: number) {
  return toISODate(addDays(new Date(`${iso}T12:00:00`), delta));
}
// cada vez que cambia la semana visible (weekStart → dayKeys), ajusta activeDayKey
// ✅ Mantén el día activo dentro de la semana visible, sin pisarlo a "hoy" o "lunes"
useEffect(() => {
  setActiveDayKey((cur) => clampToWeek(cur));
}, [dayKeys, clampToWeek]);

// (ya no dependemos de dayNames para el header, pero puedes dejarlo si lo usas en otra cosa)
const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// Helper robusto: nombre del día desde la fecha ISO (evita el bug de idx=-1 → "Lunes")
function weekdayES(iso: string) {
  // T12:00 evita “bailes” raros por timezone/DST
  const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(
    new Date(`${iso}T12:00:00`)
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type ExportMode = 'all' | 'today' | 'week' | 'range';
const [exportMode, setExportMode] = useState<ExportMode>('week');
const [rangeFrom, setRangeFrom] = useState<string>(''); // YYYY-MM-DD
const [rangeTo, setRangeTo] = useState<string>(''); // YYYY-MM-DD

useEffect(() => {
  // Por defecto: semana visible
  setRangeFrom(dayKeys[0]);
  setRangeTo(dayKeys[4]);
}, [dayKeys]);

// ✅ 1 día en móvil vertical, semana completa en horizontal/desktop
const [isMobilePortrait, setIsMobilePortrait] = useState(false);

useEffect(() => {
  if (typeof window === 'undefined') return;

  const mq = window.matchMedia('(max-width: 640px) and (orientation: portrait)');

  const update = () => setIsMobilePortrait(mq.matches);
  update();

  // compat: Safari viejo usa addListener/removeListener
  if ('addEventListener' in mq) {
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  } else {
    // @ts-ignore
    mq.addListener(update);
    // @ts-ignore
    return () => mq.removeListener(update);
  }
}, []);

const visibleDayKeys = useMemo(() => {
  // en portrait: solo el día activo
  if (isMobilePortrait) return [activeDayKey];

  // en landscape (aunque sea móvil) y en desktop: semana completa
  return dayKeys;
}, [isMobilePortrait, activeDayKey, dayKeys]);

// ✅ Labels siempre correctos
const visibleDayLabels = useMemo(() => {
  return visibleDayKeys.map((dk) => weekdayES(dk));
}, [visibleDayKeys]);

// ✅ (opcional pero recomendado) en móvil vertical, el “rango” sigue al día activo
useEffect(() => {
  if (!isMobilePortrait) return;
  setRangeFrom(activeDayKey);
  setRangeTo(activeDayKey);
}, [isMobilePortrait, activeDayKey]);

const unsubRef = useRef<null | (() => void)>(null);

const refresh = useCallback(async () => {
  if (!centerId) return;

  // si estamos offline, ni lo intentes
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  try {
    // seguimos cargando la semana visible (dayKeys[0] = lunes de esa semana)
    const data = await listWeek(centerId, dayKeys[0]);
    setItems(data as any);
  } catch (e) {
    showErr(e);
  }
}, [dayKeys, centerId]);

  useEffect(() => {
    if (!centerId) return;

    let alive = true;

    const refreshSafe = async () => {
      if (!alive) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      try {
        await refresh();
      } catch (e) {
        if (isTransientNetworkError(e)) return;
        console.warn('[REFRESH] failed', e);
      }
    };

    // 1) primera carga
    void refreshSafe();

    // 2) realtime
    unsubRef.current?.();
    unsubRef.current = subscribeItems(centerId, () => void refreshSafe());

    return () => {
      alive = false;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [centerId, refresh]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      return (
        it.name?.toLowerCase().includes(q) ||
        it.dx?.toLowerCase().includes(q) ||
        it.room?.toLowerCase().includes(q) ||
        String(it.proc ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const byCell = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of filteredItems) {
      const key = `${it.day}__${it.row}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    for (const arr of map.values()) arr.sort((a, b) => Number(a.ord) - Number(b.ord));
    return map;
  }, [filteredItems]);

const prevWeek = () => {
  if (isMobilePortrait) {
    // ← día anterior (L–V)
    setActiveDayKey((cur) => clampToWeek(addDaysISO(cur, -1)));
  } else {
    // ← semana anterior
    setWeekStart((w) => addDays(w, -7));
  }
};  
const nextWeek = () => {
  if (isMobilePortrait) {
    // → día siguiente (L–V)
    setActiveDayKey((cur) => clampToWeek(addDaysISO(cur, +1)));
  } else {
    // → semana siguiente
    setWeekStart((w) => addDays(w, +7));
  }
};
const goToday = () => {
  const today = getActiveDayISO();

  if (isMobilePortrait) {
    // solo hoy (un día)
    setActiveDayKey(clampToWeek(today));
  } else {
    // semana de hoy
  setWeekStart(startOfWeekMonday(new Date(`${today}T12:00:00`)));  }
};

const onPrev = () => {
  if (!isMobilePortrait) {
    prevWeek();
    return;
  }

  // Portrait: día a día (con salto de semana: Lunes -> Viernes de la semana anterior)
  setActiveDayKey((cur) => {
    if (cur === dayKeys[0]) {
      // estamos en lunes -> saltamos a viernes anterior
      setWeekStart((ws) => addDays(ws, -7));
      return addDaysISO(cur, -3); // lunes -> viernes anterior
    }
    return addDaysISO(cur, -1);
  });
};

const onNext = () => {
  if (!isMobilePortrait) {
    nextWeek();
    return;
  }

  // Portrait: día a día (con salto de semana: Viernes -> Lunes de la semana siguiente)
  setActiveDayKey((cur) => {
    if (cur === dayKeys[4]) {
      // estamos en viernes -> saltamos a lunes siguiente
      setWeekStart((ws) => addDays(ws, 7));
      return addDaysISO(cur, 3); // viernes -> lunes siguiente
    }
    return addDaysISO(cur, 1);
  });
};

  const onCancelAdd = () => setDraftCell(null);

  const onSubmitAdd = async (
  day: string,
  vals: { name: string; room: string; dx: string; proc: ProcKey }
) => {
  // ✅ Solo escritura si realmente estamos en modo editor
  if (effectiveRole !== "editor") return;

  try {
    if (!centerId) return;
    const cellItems = items.filter(
      (i) => i.day === day && i.row === draftCell!.row
    );

    const nextOrd =
      cellItems.length > 0
        ? Math.max(...cellItems.map((i) => Number(i.ord) || 0)) + 1
        : 1;
    const payload = {
      center_id: centerId,
      day,
      row: draftCell!.row as any,
      ord: nextOrd,
      name: (vals.name ?? "").trim(),
      room: (vals.room ?? "").trim(),
      dx: (vals.dx ?? "").trim(),
      proc: vals.proc as any,
      done: false,
    };

    console.log("[ADD] vals=", vals);
    console.log("[ADD] payload=", payload);

    // Evita guardar tarjetas “vacías”
    if (!payload.name && !payload.dx && !payload.room) {
      alert("No puedes guardar un paciente vacío.");
      return;
    }

    const created = await addItem(payload as any);
    console.log("[ADD] created row from supabase=", created);

    setDraftCell(null);
    await refresh();
  } catch (e) {
    showErr(e);
  }
};

  const onSubmitEdit = async (
  id: string,
  vals: { name: string; room: string; dx: string; proc: ProcKey }
) => {
  // ✅ Solo escritura si realmente estamos en modo editor
  if (effectiveRole !== "editor") return;

  try {
    const patch = {
      name: (vals.name ?? "").trim(),
      room: (vals.room ?? "").trim(),
      dx: (vals.dx ?? "").trim(),
      proc: vals.proc as any,
    };

    console.log("[EDIT] id=", id);
    console.log("[EDIT] vals=", vals);
    console.log("[EDIT] patch=", patch);

    await updateItem(id, patch as any);

    setEditId(null);
    await refresh();
  } catch (e) {
    showErr(e);
  }
};

 const exportCSV = async () => {
  try {
    if (!centerId) throw new Error('Centro no cargado todavía');

    const header = ['Día', 'Sala', 'Orden', 'Paciente', 'Habitación/Obs', 'Dx', 'Procedimiento', 'Hecho'];
    const lines = [header.join(';')];

    const todayISO = toISODate(new Date());

    let from: string | null = null;
    let to: string | null = null;

    if (exportMode === 'today') {
      from = todayISO;
      to = todayISO;
    } else if (exportMode === 'week') {
      from = dayKeys[0];
      to = dayKeys[4];
    } else if (exportMode === 'range') {
      if (!rangeFrom || !rangeTo) throw new Error('Selecciona fecha de inicio y fin');
      from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
      to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    } // 'all' => sin rango

    let q = supabase
      .from('items')
      .select('day,row,ord,name,room,dx,proc,done')
      .eq('center_id', centerId)
      .order('day', { ascending: true })
      .order('row', { ascending: true })
      .order('ord', { ascending: true });

    if (from) q = q.gte('day', from);
    if (to) q = q.lte('day', to);

    const { data, error } = await q;
    if (error) throw error;

    for (const it of data ?? []) {
      lines.push(
        [
          String(it.day ?? ''),
          String(it.row ?? ''),
          String(it.ord ?? ''),
          String(it.name ?? ''),
          String(it.room ?? ''),
          String(it.dx ?? ''),
          String(it.proc ?? ''),
          it.done ? '1' : '0',
        ]
          .map((x) => String(x).replaceAll(';', ','))
          .join(';'),
      );
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const suffix =
      exportMode === 'all'
        ? 'todo'
        : exportMode === 'today'
        ? todayISO
        : exportMode === 'week'
        ? `${dayKeys[0]}_a_${dayKeys[4]}`
        : `${from}_a_${to}`;

    a.href = url;
    a.download = `pizarra_${suffix}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    showErr(e);
  }
};

const doDelete = async (id: string) => {
  // ✅ Solo escritura si realmente estamos en modo editor
  if (effectiveRole !== "editor") return;

  if (!confirm("¿Eliminar este paciente?")) return;

  try {
    await deleteItem(id);
    await refresh();
  } catch (e) {
    showErr(e);
  }
};

const doToggleDone = async (it: Item) => {
  try {
    if (role === 'editor') {
      await updateItem(it.id, { done: !it.done } as any);
    } else {
      // viewer: solo toggle vía RPC
      const { error } = await supabase.rpc('toggle_item_done', { p_id: it.id });
      if (error) throw error;
    }
    await refresh();
  } catch (e) {
    console.error('toggle done failed', e);
    showErr(e);
  }
};
  /* ---- movimiento robusto ↑ / ↓ con swap de ord ---- */
  const moveOneUp = async (it: Item) => {
    const cell = items
      .filter((i) => i.day === it.day && i.row === it.row)
      .sort((a, b) => Number(a.ord) - Number(b.ord));
    const idx = cell.findIndex((i) => i.id === it.id);
    if (idx <= 0) return;
    const prev = cell[idx - 1];
    const itOrd = Number(it.ord);
    const prevOrd = Number(prev.ord);

    try {
      await updateItem(it.id, { ord: prevOrd } as any);
      await updateItem(prev.id, { ord: itOrd } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  };

  const moveOneDown = async (it: Item) => {
    const cell = items
      .filter((i) => i.day === it.day && i.row === it.row)
      .sort((a, b) => Number(a.ord) - Number(b.ord));
    const idx = cell.findIndex((i) => i.id === it.id);
    if (idx < 0 || idx >= cell.length - 1) return;
    const next = cell[idx + 1];
    const itOrd = Number(it.ord);
    const nextOrd = Number(next.ord);

    try {
      await updateItem(it.id, { ord: nextOrd } as any);
      await updateItem(next.id, { ord: itOrd } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  };

  const moveRowUp = async (it: Item) => {
    const rIdx = rows.indexOf(it.row as any);
    if (rIdx <= 0) return;
    const destRow = rows[rIdx - 1] as RowKey;

    try {
      await updateItem(it.id, { row: destRow as any } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  };

  const moveRowDown = async (it: Item) => {
    const rIdx = rows.indexOf(it.row as any);
    if (rIdx < 0 || rIdx >= rows.length - 1) return;
    const destRow = rows[rIdx + 1] as RowKey;

    try {
      await updateItem(it.id, { row: destRow as any } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  };
const moveDayLeft = async (it: Item) => {
  const idx = dayKeys.indexOf(it.day);

  // 🔹 Caso normal: dentro de la semana visible
  if (idx > 0) {
    const destDay = dayKeys[idx - 1];
    try {
      await updateItem(it.id, { day: destDay } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
    return;
  }

  // 🔹 NUEVO: lunes → viernes anterior
  if (idx === 0) {
    const destDay = prevBusinessDayISO(it.day);
    try {
      await updateItem(it.id, { day: destDay } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  }
};

const moveDayRight = async (it: Item) => {
  const idx = dayKeys.indexOf(it.day);

  // 🔹 Caso normal: dentro de la semana visible
  if (idx >= 0 && idx < dayKeys.length - 1) {
    const destDay = dayKeys[idx + 1];
    try {
      await updateItem(it.id, { day: destDay } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
    return;
  }

  // 🔹 NUEVO: viernes → lunes siguiente
  if (idx === dayKeys.length - 1) {
    const destDay = nextBusinessDayISO(it.day);
    try {
      await updateItem(it.id, { day: destDay } as any);
      await refresh();
    } catch (e) {
      showErr(e);
    }
  }
};

//Función para que pase de viernes a lunes y de lunes a viernes
function parseISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nextBusinessDayISO(iso: string) {
  const dt = parseISODate(iso);
  const dow = dt.getDay(); // 0 dom, 1 lun, ... 5 vie, 6 sab

  // Vie → Lun
  if (dow === 5) dt.setDate(dt.getDate() + 3);
  // Sab → Lun
  else if (dow === 6) dt.setDate(dt.getDate() + 2);
  // Dom → Lun
  else if (dow === 0) dt.setDate(dt.getDate() + 1);
  // Lun–Jue → día siguiente
  else dt.setDate(dt.getDate() + 1);

  return toISODate(dt);
}

function prevBusinessDayISO(iso: string) {
  const dt = parseISODate(iso);
  const dow = dt.getDay();

  // Lun → Vie
  if (dow === 1) dt.setDate(dt.getDate() - 3);
  // Dom → Vie
  else if (dow === 0) dt.setDate(dt.getDate() - 2);
  // Sab → Vie
  else if (dow === 6) dt.setDate(dt.getDate() - 1);
  // Mar–Vie → día anterior
  else dt.setDate(dt.getDate() - 1);

  return toISODate(dt);
}

function getActiveDayISO() {
  // usamos el mediodía local para evitar líos de timezone/DST
  const d = new Date();
  d.setHours(12, 0, 0, 0);

  const wd = d.getDay(); // 0=domingo ... 6=sábado
  if (wd === 6) d.setDate(d.getDate() + 2); // sábado -> lunes
  if (wd === 0) d.setDate(d.getDate() + 1); // domingo -> lunes

  return toISODate(d); // ✅ local, consistente con dayKeys
}

function formatDateES(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const swipeHandlers = useSwipeable({
  onSwipedLeft: () => onNext(),
  onSwipedRight: () => onPrev(),
  preventScrollOnSwipe: true,
  trackTouch: true,
  delta: 60,
  touchEventOptions: { passive: false },
});

const [fitScreen, setFitScreen] = useState(false);


  return (
  <div {...swipeHandlers} className="flex flex-col gap-3">

    {/* ✅ STICKY HEADER (Paso 1) */}
    <div
      className="
        sticky top-0 z-40
        -mx-4 px-4 pt-3 pb-2
        bg-white/90 backdrop-blur
        border-b border-gray-200
        dark:bg-black/70 dark:border-white/10
      "
    >
      <div className="mt-3 flex flex-col gap-2">
        {/* FILA 1 */}
        <div className="flex items-center justify-between gap-2">
          {/* IZQUIERDA */}
          <div className="flex items-center gap-2">
            <button
              className="p-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-white/30"
              title="Anterior"
              onClick={onPrev}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <button
              className="p-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-white/30"
              title="Siguiente"
              onClick={onNext}
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm flex items-center gap-2
                         dark:hover:bg-gray-800 dark:border-white/30"
              onClick={goToday}
            >
              <Calendar className="w-4 h-4" />
              Hoy
            </button>

            {/* SOLO LECTURA */}
            {role === "editor" && (
              <button
                type="button"
                onClick={() => setReadOnly((v) => !v)}
                className="
                  inline-flex items-center gap-2 px-2 py-1 rounded-lg border text-sm
                  bg-white text-gray-700 border-gray-300 hover:bg-gray-50
                  dark:bg-gray-900 dark:text-white dark:border-white/30 dark:hover:bg-gray-800
                "
              >
                <span className="text-xs">Solo lectura</span>

                <span
                  className={[
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    readOnly ? "bg-emerald-600" : "bg-gray-300 dark:bg-gray-700",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      readOnly ? "translate-x-5" : "translate-x-1",
                    ].join(" ")}
                  />
                </span>
              </button>
            )}
            {/* INGRESADOS */}
{isEditorUser && (
  <button
    type="button"
    onClick={() => setInpatientsOpen(true)}
    className="
      inline-flex items-center gap-2 px-2 py-1 rounded-lg border text-sm
      bg-white text-gray-700 border-gray-300 hover:bg-gray-50
      dark:bg-gray-900 dark:text-white dark:border-white/30 dark:hover:bg-gray-800
    "
    title="Ingresados"
  >
    <BedDouble className="w-4 h-4" />
    <span className="text-xs hidden sm:inline">Ingresados</span>
    <span
      className="
        text-[11px] px-2 py-0.5 rounded-full border
        bg-gray-50 border-gray-200 text-gray-700
        dark:bg-gray-800 dark:border-white/20 dark:text-gray-200
      "
    >
      {inpatientSet.size}
    </span>
  </button>
)}
          </div>

          {/* DERECHA (desktop) */}
          <div className="hidden md:flex items-center gap-2">
            {/* BUSCADOR desktop */}
            <input
              className="
                border rounded-lg px-3 py-2 text-sm w-[260px]
                dark:bg-gray-900 dark:text-gray-100 dark:border-white/30
              "
              placeholder="Buscar…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {/* EXPORT desktop */}
            {effectiveRole === "editor" && (
              <>
                <select
                  className="border rounded-lg px-3 py-2 text-sm
                    bg-white text-gray-700 border-gray-300 hover:bg-gray-50
                    dark:bg-gray-900 dark:text-gray-200 dark:border-white/30 dark:hover:bg-gray-800"
                  value={exportMode}
                  onChange={(e) => setExportMode(e.target.value as ExportMode)}
                >
                  <option value="all">Todo</option>
                  <option value="today">Hoy</option>
                  <option value="week">Esta semana</option>
                  <option value="range">Período</option>
                </select>

                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm flex items-center gap-2
                             dark:hover:bg-gray-800 dark:border-white/30"
                  onClick={() => void exportCSV()}
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
              </>
            )}
          </div>
        </div>

        {/* FILA 2 (solo móvil): buscador */}
        <div className="md:hidden">
          <input
            className="
              border rounded-lg px-3 py-2 text-sm w-full
              dark:bg-gray-900 dark:text-gray-100 dark:border-white/30
            "
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
    </div>

    {/* ... aquí sigue tu grid etc ... */}
    <div
      className={[
        "grid",
        fitScreen ? "gap-1" : "gap-2",
        isMobilePortrait
          ? "grid-cols-[80px_minmax(0,1fr)]"
          : "grid-cols-[80px_repeat(5,minmax(0,1fr))]",
      ].join(" ")}
    >
      <div className="flex items-center">
        <select
          className="
            border rounded px-2 py-1 text-xs
            text-gray-700 dark:text-gray-200
            bg-white dark:bg-gray-900
            border-gray-300 dark:border-gray-600
          "
          value={roomFilter}
          onChange={(e) => setRoomFilter(e.target.value as RowKey)}
          title="Filtrar por sala"
        >
          <option value="__all__">Todas</option>
          {rows.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {visibleDayKeys.map((dk) => {
        const isToday = dk === todayKey;

        return (
          <div
            key={dk}
            className={[
              "text-xs font-semibold text-center rounded-lg py-1 border transition-colors",
              isToday
                ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:border-rose-300/40"
                : "text-gray-500 border-transparent dark:text-gray-300",
            ].join(" ")}
          >
            <div>{weekdayES(dk)}</div>
            <div className="text-[11px] font-normal text-gray-400 dark:text-gray-400">
              {formatDateES(dk)}
            </div>
          </div>
        );
      })}

      {visibleRows.map((row) => (
        <RowBlock
          key={row}
          role={effectiveRole}
          isEditorUser={isEditorUser}
          row={row}
          dayKeys={visibleDayKeys}
          byCell={byCell}
          draftCell={draftCell}
          setDraftCell={setDraftCell}
          editId={editId}
          setEditId={setEditId}
          onSubmitAdd={onSubmitAdd}
          onCancelAdd={onCancelAdd}
          onSubmitEdit={onSubmitEdit}
          doDelete={doDelete}
          doToggleDone={doToggleDone}
          moveOneUp={moveOneUp}
          moveOneDown={moveOneDown}
          moveRowUp={moveRowUp}
          moveRowDown={moveRowDown}
          moveDayLeft={moveDayLeft}
          moveDayRight={moveDayRight}
          procs={procs}
          activeDayKey={activeDayKey}
          todayKey={todayKey}
          toggleInpatient={toggleInpatient}
          inpatientSet={inpatientSet}
          fitScreen={fitScreen}
        />
      ))}
    </div>

    {/* ✅ Botón flotante: Ajustar a pantalla */}
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setFitScreen((v) => !v)}
        className="
          px-3 py-2 rounded-xl border shadow-sm text-sm
          bg-white text-gray-700 border-gray-300 hover:bg-gray-50
          dark:bg-gray-900 dark:text-gray-200 dark:border-white/30 dark:hover:bg-gray-800
        "
        title={fitScreen ? "Volver a tamaño normal" : "Ajustar a pantalla"}
      >
        {fitScreen ? "Normal" : "Ajustar"}
      </button>
    </div>

    {/* Modal: Ingresados */}
    {inpatientsOpen && (
      <div className="fixed inset-0 z-[60]">
        {/* overlay */}
        <button
          className="absolute inset-0 bg-black/40"
          onClick={() => setInpatientsOpen(false)}
          aria-label="Cerrar"
          type="button"
        />

        {/* panel */}
        <div
          className="
            absolute left-1/2 top-1/2 w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2
            rounded-2xl border bg-white shadow-xl
            dark:bg-gray-950 dark:border-gray-700
          "
        >
          <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2">
              <BedDouble className="w-5 h-5 text-gray-600 dark:text-gray-200" />
              <div className="font-semibold dark:text-gray-100">Ingresados</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                ({inpatients.length})
              </div>
            </div>

            <button
              className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                         dark:border-gray-700 dark:text-gray-100"
              onClick={() => setInpatientsOpen(false)}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="p-4 max-h-[72vh] overflow-auto">
            {inpatientsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando…
              </div>
            ) : inpatients.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                No hay pacientes ingresados.
              </div>
            ) : (
              <div className="space-y-2">
                {inpatients.map((r) => {
                  const meta = inpatientMetaMap[r.source_item_id];
                  const proc = meta?.proc || '';
                  const procDate = formatShortES(meta?.day || r.admitted_at);

                  return (
                    <div
                      key={r.id}
                      className="
                        rounded-xl border p-2
                        border-gray-200 bg-white
                        dark:border-gray-800 dark:bg-gray-900/30
                      "
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                            {r.name ?? 'Paciente'}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void dischargeInpatient(r.id)}
                          className="
                            px-3 py-2 rounded-lg border text-sm font-medium
                            bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white
                            dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:border-emerald-600 dark:text-white
                          "
                          title="Dar de alta (quitar del listado)"
                        >
                          Dar de alta
                        </button>
                      </div>

                      <div className="mt-2 flex flex-col gap-2">
                        {/* MÓVIL: Cama + Proc + Fecha en la misma línea; Dx debajo */}
                        <div className="flex flex-col gap-2 md:hidden">
                          <div className="flex items-end gap-2">
                            {/* Cama */}
                            <div className="flex-1">
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                                Cama
                              </div>
                              <input
                                className="w-full border rounded-lg px-3 py-1.5 text-sm
                                       dark:bg-gray-900 dark:text-gray-100 dark:border-white/20"
                                value={r.bed ?? ''}
                                onChange={(e) =>
                                  updateInpatientFieldDebounced(r.id, { bed: e.target.value })
                                }
                                placeholder="Cama / Habitación"
                              />
                            </div>

                            {/* Chip Procedimiento */}
                            {proc ? (
                              <span
                                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border whitespace-nowrap h-[34px]"
                                style={{
                                  backgroundColor: '#EEF2FF',
                                  color: '#1F2937',
                                  borderColor: '#C7D2FE',
                                }}
                                title="Procedimiento (copiado de la pizarra)"
                              >
                                {String(proc)}
                              </span>
                            ) : null}

                            {/* Fecha */}
                            {procDate ? (
                              <span
                                className="inline-flex items-center px-2 py-1 rounded-md text-[11px] border whitespace-nowrap h-[34px]
                                       bg-gray-50 text-gray-700 border-gray-200
                                       dark:bg-gray-800 dark:text-gray-200 dark:border-white/20"
                                title="Fecha procedimiento"
                              >
                                {procDate}
                              </span>
                            ) : null}
                          </div>

                          {/* Dx debajo en móvil */}
                          <div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Diagnóstico
                            </div>
                            <input
                              className="w-full border rounded-lg px-3 py-1.5 text-sm
                                     dark:bg-gray-900 dark:text-gray-100 dark:border-white/20"
                              value={r.dx ?? ''}
                              onChange={(e) =>
                                updateInpatientFieldDebounced(r.id, { dx: e.target.value })
                              }
                              placeholder="Dx"
                            />
                          </div>
                        </div>

                        {/* DESKTOP: Cama + Dx + Proc + Fecha en la misma línea */}
                        <div className="hidden md:grid grid-cols-4 gap-2 items-end">
                          {/* Cama */}
                          <div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Cama
                            </div>
                            <input
                              className="w-full border rounded-lg px-3 py-1.5 text-sm
                                     dark:bg-gray-900 dark:text-gray-100 dark:border-white/20"
                              value={r.bed ?? ''}
                              onChange={(e) =>
                                updateInpatientFieldDebounced(r.id, { bed: e.target.value })
                              }
                              placeholder="Cama / Habitación"
                            />
                          </div>

                          {/* Dx */}
                          <div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Diagnóstico
                            </div>
                            <input
                              className="w-full border rounded-lg px-3 py-1.5 text-sm
                                     dark:bg-gray-900 dark:text-gray-100 dark:border-white/20"
                              value={r.dx ?? ''}
                              onChange={(e) =>
                                updateInpatientFieldDebounced(r.id, { dx: e.target.value })
                              }
                              placeholder="Dx"
                            />
                          </div>

                          {/* Procedimiento (chip) */}
                          <div className="min-w-0">
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Procedimiento
                            </div>
                            {proc ? (
                              <span
                                className="inline-flex max-w-full items-center px-2 py-2 rounded-md text-xs font-medium border whitespace-nowrap overflow-hidden text-ellipsis"
                                style={{
                                  backgroundColor: '#EEF2FF',
                                  color: '#1F2937',
                                  borderColor: '#C7D2FE',
                                }}
                                title={String(proc)}
                              >
                                {String(proc)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                            )}
                          </div>

                          {/* Fecha */}
                          <div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                              Fecha
                            </div>
                            {procDate ? (
                              <span
                                className="inline-flex items-center px-2 py-2 rounded-md text-xs border whitespace-nowrap
                                       bg-gray-50 text-gray-700 border-gray-200
                                       dark:bg-gray-800 dark:text-gray-200 dark:border-white/20"
                                title="Fecha procedimiento"
                              >
                                {procDate}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                            )}
                          </div>
                        </div>

                        {/* Evolución abajo, compacta */}
                        <div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                            Evolución
                          </div>
                          <textarea
                            className="w-full border rounded-lg px-3 py-1.5 text-sm min-h-[56px]
                                       dark:bg-gray-900 dark:text-gray-100 dark:border-white/20"
                            value={r.evolution ?? ''}
                            onChange={(e) =>
                              updateInpatientFieldDebounced(r.id, {
                                evolution: e.target.value,
                              })
                            }
                            placeholder="Escribe la evolución…"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 border-t dark:border-gray-800 flex justify-end">
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm
                         dark:hover:bg-gray-800 dark:border-white/20 dark:text-gray-100"
              onClick={() => setInpatientsOpen(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
function RowBlock({
  role,
  isEditorUser,
  row,
  dayKeys,
  byCell,
  draftCell,
  setDraftCell,
  editId,
  setEditId,
  onSubmitAdd,
  onCancelAdd,
  onSubmitEdit,
  doDelete,
  doToggleDone,
  moveOneUp,
  moveOneDown,
  moveRowUp,
  moveRowDown,
  moveDayLeft,
  moveDayRight,
  toggleInpatient,
  inpatientSet,
  procs,
  activeDayKey,
  todayKey,
  fitScreen,
}: any) {
  const Chip = ({ children, tone = 'gray' }: { children: any; tone?: 'gray' | 'green' }) => (
    <span
      className={[
        'inline-flex items-center px-2 py-1 rounded-md text-xs border',
        tone === 'green' 
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-400/40'
        : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-white/40',
      ].join(' ')}
    >
      {children}
    </span>
  );

  return (
    <>
      <div className="border border-gray-200 dark:border-white/30 rounded-lg p-2 text-sm font-semibold bg-gray-50 dark:bg-gray-900/40 text-gray-800 dark:text-gray-100">{row}</div>

      {dayKeys.map((dk: string) => {
  const cellKey = `${dk}__${row}`;
  const cell = byCell.get(cellKey) ?? [];
  const isDraftHere = draftCell?.day === dk && draftCell?.row === row;

  const isHighlighted = dk === todayKey; // ✅ SOLO HOY (o lunes si finde)

  return (
    <div
      key={cellKey}
      className={[
  'border rounded-lg flex flex-col',
  fitScreen ? 'p-1 gap-1 min-h-[96px]' : 'p-2 gap-2 min-h-[120px]',
  isHighlighted
    ? 'bg-rose-50/40 border-rose-200 dark:bg-rose-500/10 dark:border-rose-300/40'
    : 'bg-white dark:bg-gray-900/20 border-gray-200 dark:border-white/30',
].join(' ')}
    >
          
            {/* Botón "Añadir paciente" solo si no hay editor abierto */}
            {role === 'editor' && !isDraftHere && (
              <button
              className="
                w-full flex items-center justify-center gap-2
                border rounded-lg py-2 text-sm
                bg-white text-gray-700 border-gray-200
                hover:bg-gray-50

                dark:bg-gray-900/40
                dark:text-gray-200
                dark:border-white/30
                dark:hover:bg-gray-800/60
              "
              onClick={() => setDraftCell({ day: dk, row })}
            >
              <Plus className="w-4 h-4" />
              Añadir paciente
            </button>
            )}

            {isDraftHere && (
              <InlineEditorCard
                title="Nuevo paciente"
                procs={procs}
                onCancel={onCancelAdd}
                onSave={(vals) => onSubmitAdd(dk, vals)}
              />
            )}

            {cell.map((it: Item) => {
              const editing = editId === it.id;
              const ordNum = cell.findIndex((x: Item) => x.id === it.id) + 1;

              if (editing) {
                return (
                  <InlineEditorCard
                    procs={procs}
                    key={it.id}
                    title="Editar paciente"
                    initial={{
                      name: it.name ?? '',
                      room: it.room ?? '',
                      dx: it.dx ?? '',
                      proc: (it.proc ?? 'Coronaria') as any,
                    }}
                    onCancel={() => setEditId(null)}
                    onSave={(vals) => onSubmitEdit(it.id, vals)}
                  />
                );
              }

              return (
                <div
                  key={it.id}
                  className={[
  'border rounded-xl p-3 shadow-sm transition-colors',
  it.done
    ? 'bg-gray-100 border-gray-200 opacity-80 dark:bg-gray-800 dark:border-gray-700'
    : 'bg-white dark:bg-gray-900'
].join(' ')}
                >
                 {/* Barra de comandos (puede envolver a 2 líneas) */}
<div className="flex flex-wrap items-center justify-between gap-2">
  <div className="flex items-center gap-2">
    <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs text-gray-700 bg-white">
      {ordNum}
    </div>

    {/* ✅ Hecho: visible y clicable también en viewer */}
    <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Hecho" onClick={() => doToggleDone(it)}>
      {it.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Circle className="w-4 h-4 text-gray-500 dark:text-gray-30" />}
    </button>

    {/* ✅ Ingresado (cama): visible para editores incluso en modo solo lectura; clic solo si editor efectivo */}
    {isEditorUser && (role === 'editor' || inpatientSet?.has(it.id)) && (
      <button
        type="button"
        disabled={role !== 'editor'}
        className={[
          'p-1 rounded border transition-colors',
          'bg-gray-50 border-gray-200',
          'dark:bg-gray-800/60 dark:border-white/20',
          inpatientSet?.has(it.id)
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-gray-500 dark:text-gray-300',
          role === 'editor'
            ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
            : 'opacity-70 cursor-default',
        ].join(' ')}
        title={
          inpatientSet?.has(it.id)
            ? role === 'editor'
              ? 'Ingresado (click para alta)'
              : 'Ingresado'
            : 'Marcar como ingresado'
        }
        onClick={() => {
          if (role !== 'editor') return;
          toggleInpatient(it);
        }}
      >
        <BedDouble className="w-4 h-4" />
      </button>
    )}

    {/* ✅ Todo lo demás SOLO si editor, manteniendo el orden */}
    {role === 'editor' && (
      <>
        <div className="w-px h-4 bg-gray-200 mx-1" />

        <button className="p-1 rounded hover:bg-gray-100" title="Editar" onClick={() => setEditId(it.id)}>
          <Pencil className="w-4 h-4" />
        </button>
        <button className="p-1 rounded hover:bg-gray-100" title="Eliminar" onClick={() => doDelete(it.id)}>
          <Trash2 className="w-4 h-4" />
        </button>
      </>
    )}
  </div>

  {/* mover día / orden / sala SOLO editor */}
  {role === 'editor' && (
    <div className="flex flex-wrap items-center gap-1">
      <button className="p-1 rounded hover:bg-gray-100" title="Mover a día anterior" onClick={() => moveDayLeft(it)}>
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button className="p-1 rounded hover:bg-gray-100" title="Subir (orden)" onClick={() => moveOneUp(it)}>
        <ArrowUp className="w-4 h-4" />
      </button>
      <button className="p-1 rounded hover:bg-gray-100" title="Bajar (orden)" onClick={() => moveOneDown(it)}>
        <ArrowDown className="w-4 h-4" />
      </button>
      <button className="p-1 rounded hover:bg-gray-100" title="Mover sala arriba" onClick={() => moveRowUp(it)}>
        <ChevronsUp className="w-4 h-4" />
      </button>
      <button className="p-1 rounded hover:bg-gray-100" title="Mover sala abajo" onClick={() => moveRowDown(it)}>
        <ChevronsDown className="w-4 h-4" />
      </button>
      <button className="p-1 rounded hover:bg-gray-100" title="Mover a día siguiente" onClick={() => moveDayRight(it)}>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )}
</div>

                  {/* Nombre */}
                  <div className="mt-2 text-sm font-semibold break-words text-gray-900 dark:text-gray-100">{it.name}</div>

                  {/* Chips */}
                  <div className="mt-2 flex flex-col gap-2">
                    {/* Dx (puede ir arriba) */}
                    {it.dx ? (
                      <div className="flex flex-wrap gap-2">
                        <Chip>Dx: {it.dx}</Chip>
                      </div>
                    ) : null}

                    {/* Línea compacta: Hab + Proc + Fecha (en móvil misma línea) */}
                    <div className="flex flex-wrap items-center gap-2">
                      {it.room ? <Chip>Hab: {it.room}</Chip> : null}

                      {it.proc
                        ? (() => {
                            const meta = procs.find((p: ProcDef) => p.name === it.proc);
                            const bg = meta?.color_bg ?? '#EEF2FF';
                            const fg = meta?.color_text ?? '#1F2937';
                            return (
                              <span
                                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border"
                                style={{
                                  backgroundColor: bg,
                                  color: fg,
                                  borderColor: 'rgba(0,0,0,0.10)',
                                }}
                              >
                                {String(it.proc)}
                              </span>
                            );
                          })()
                        : null}

                      {/* Fecha del procedimiento (abreviada) */}
                      {it.day ? (
                        <span
                          className="inline-flex items-center px-2 py-1 rounded-md text-[11px] border whitespace-nowrap
                                     bg-gray-50 text-gray-700 border-gray-200
                                     dark:bg-gray-800 dark:text-gray-200 dark:border-white/20"
                          title="Fecha"
                        >
                          {formatShortES(it.day)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}