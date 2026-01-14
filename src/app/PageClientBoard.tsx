'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { startOfWeekMonday, addDays, toISODate } from '@/lib/date';
import Image from 'next/image';
import Link from 'next/link';

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
    msg.includes('timeout')
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
export default function PageClientBoard({ slug }: { slug: string }) {
  // ─────────────────────────────────────────────────────────────
  // 0) Auto-refresh auth (evita doble ejecución en dev / StrictMode)
  // ─────────────────────────────────────────────────────────────
  const didInitAuth = useRef(false);

  useEffect(() => {
    if (didInitAuth.current) return;
    didInitAuth.current = true;

    console.log('[AUTH] startAutoRefresh');
    supabase.auth.startAutoRefresh();

    return () => {
      console.log('[AUTH] stopAutoRefresh');
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  // (debug opcional)
  useEffect(() => {
    const t = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      console.log('[AUTH] session?', !!data.session, 'expires_at', data.session?.expires_at);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<'editor' | 'viewer' | 'unknown'>('unknown');

  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerName, setCenterName] = useState<string>('Centro');
  const [rows, setRows] = useState<RowKey[]>([]);
  const [procs, setProcs] = useState<ProcDef[]>([]);
  const [openRoomsToday, setOpenRoomsToday] = useState<number | null>(null);

  // ─────────────────────────────────────────────────────────────
  // 1) Cargar configuración del centro
  // ─────────────────────────────────────────────────────────────
  const loadCenterConfig = useCallback(async () => {
    const { data: center, error: cErr } = await supabase
      .from('centers')
      .select('id, slug, name')
      .eq('slug', slug)
      .single();

    if (cErr) throw cErr;
    if (!center?.id) throw new Error(`Centro no encontrado: ${slug}`);

    setCenterId(center.id);
    setCenterName(center.name || slug);

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
      .maybeSingle();

    if (sErr) throw sErr;

    const open = sched?.open_rooms ?? roomNames.length ?? null;
    setOpenRoomsToday(typeof open === 'number' ? open : null);
  }, [slug]);

  // ─────────────────────────────────────────────────────────────
  // 2) Auth bootstrap + listener (robusto)
  //    (IMPORTANTE: aquí NO tocamos realtime.disconnect/connect)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    const boot = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;

        console.log('[AUTH] mount user =', !!data.user);
        setAuthReady(true);

        // role depende de slug
        try {
          setRole(data.user ? await getMyRole(slug) : 'unknown');
        } catch (e) {
          console.warn('[AUTH] getMyRole failed', e);
          setRole(data.user ? 'viewer' : 'unknown');
        }

        // Carga config, pero si hay fallo de red NO rompas nada
        try {
          await loadCenterConfig();
        } catch (e) {
          if (isTransientNetworkError(e)) {
            console.warn('[AUTH] loadCenterConfig transient error', e);
          } else {
            console.warn('[AUTH] loadCenterConfig failed', e);
          }
        }

        const { data: listener } = supabase.auth.onAuthStateChange(async (_event, sess) => {
          if (cancelled) return;

          console.log('[AUTH] onAuthStateChange user =', !!sess?.user);
          setAuthReady(true);

          try {
            setRole(sess?.user ? await getMyRole(slug) : 'unknown');
          } catch (e) {
            console.warn('[AUTH] getMyRole failed', e);
            setRole(sess?.user ? 'viewer' : 'unknown');
          }

          try {
            await loadCenterConfig();
          } catch (e) {
            console.warn('[AUTH] loadCenterConfig failed (will recover in Board)', e);
          }
        });

        unsub = listener.subscription;
      } catch (e) {
        if (isTransientNetworkError(e)) {
          console.warn('[AUTH] transient network error in boot', e);
          setAuthReady(true);
          return;
        }

        showErr(e);
        setAuthReady(true);
        setRole('unknown');
      }
    };

    void boot();

    return () => {
      cancelled = true;
      if (unsub) unsub.unsubscribe();
    };
  }, [loadCenterConfig, slug]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-[1200px] mx-auto">
      <Header role={role} centerName={centerName} openRoomsToday={openRoomsToday} />
      {!authReady ? (
        <div className="text-sm text-gray-600">Cargando…</div>
      ) : role === 'unknown' ? (
        <div className="text-sm text-gray-600">
          Inicia sesión para editar. (Modo lectura si no tienes permisos)
        </div>
      ) : (
        <Board role={role} rows={rows} procs={procs} centerId={centerId} />
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
    <div className="mb-4 flex items-start justify-between">
      {/* IZQUIERDA */}
      <div className="flex items-center gap-4">
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

        <div className="flex flex-col">
          <div className="text-xl font-semibold leading-tight text-blue-900">
            {centerName || 'Cargando centro...'}
          </div>
          <div className="text-xs text-gray-500">
            {openRoomsToday == null ? 'Salas abiertas hoy: —' : `Salas abiertas hoy: ${openRoomsToday}`}
          </div>
        </div>
      </div>

      {/* DERECHA */}
      <div className="flex items-center gap-2">
        <span className="text-sm px-2 py-1 border rounded-full bg-white">
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);
    })();

    const sub = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setUserEmail(sess?.user?.email ?? null);
    });

    return () => sub.data.subscription.unsubscribe();
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
    } catch (e) {
      showErr(e);
    }
  };

  const signOut = async () => {
    try {
      localStorage.removeItem('salatrack_readonly');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e) {
      showErr(e);
    }
  };

  // ─────────────────────────────────────────────
  // Usuario autenticado
  // ─────────────────────────────────────────────
  if (userEmail) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {userEmail}
        </span>
        <button
          className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50"
          onClick={signOut}
        >
          Salir
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Login (ENTER funciona)
  // ─────────────────────────────────────────────
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault(); // evita reload
        signIn();
      }}
    >
      <input
        className="w-[140px] sm:w-[180px] border rounded-lg px-2 py-1 text-sm"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="w-[120px] sm:w-[140px] border rounded-lg px-2 py-1 text-sm"
        placeholder="password"
        type="password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
      />
      <button
        type="submit"
        className="px-2 py-1 text-sm border rounded-lg hover:bg-gray-50"
      >
        Entrar
      </button>
    </form>
  );
}

function formatDateES(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
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
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');

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
const [roomFilter, setRoomFilter] = useState<RowKey>('__all__');
const visibleRows = useMemo(() => {
  if (roomFilter === '__all__') return rows;
  return rows.filter((r) => r === roomFilter);
}, [rows, roomFilter]);


// rol efectivo: si editor + readOnly => se comporta como viewer
const effectiveRole = (role === "editor" && readOnly) ? "viewer" : role;

 // Semana (L-V) en ISO (semana visible)
const dayKeys = useMemo(() => {
  const days: string[] = [];
  for (let i = 0; i < 5; i++) days.push(toISODate(addDays(weekStart, i)));
  return days;
}, [weekStart]);

// Día activo REAL (hoy, ajustado fin de semana) — NO depende de weekStart
const activeDayKey = useMemo(() => getActiveDayISO(), []);

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
const [rangeTo, setRangeTo] = useState<string>('');     // YYYY-MM-DD

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

// ✅ Esto sustituye a visibleDayNames: siempre correcto (aunque activeDayKey no esté en dayKeys)
const visibleDayLabels = useMemo(() => {
  return visibleDayKeys.map((dk) => weekdayES(dk));
}, [visibleDayKeys]);

const unsubRef = useRef<null | (() => void)>(null);
const rejoinBusyRef = useRef(false);

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
    try {
      await refresh();
    } catch (e) {
      // no rompas UI si un fetch falla (sleep / offline / reconexión)
      console.warn('[REFRESH] failed', e);
    }
  };

  // 1) primera carga
  void refreshSafe();

  // 2) realtime (guardar en ref para rejoin)
  unsubRef.current?.();
  unsubRef.current = subscribeItems(centerId, () => void refreshSafe());

  // 3) polling de seguridad
  const poll = setInterval(() => {
  console.log('[POLL] tick');
  void refreshSafe();
}, 20_000);

  // 4) rejoin tras reposo / volver a pestaña / volver online
  const rejoin = async () => {
  if (!alive) return;
  if (rejoinBusyRef.current) return;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  rejoinBusyRef.current = true;
  console.log('[RECOVER] begin');

  try {
    await new Promise((r) => setTimeout(r, 700));

    // refresca sesión (con retry)
    try {
      await retry(() => supabase.auth.refreshSession(), 4, 500);
    } catch (e) {
      console.warn('[RECOVER] refreshSession failed (will still try data)', e);
    }

    // reinicia realtime
    try {
      supabase.realtime.disconnect();
    } catch {}
    try {
      supabase.realtime.connect();
    } catch {}

    // re-suscribe canal realtime
    try {
      unsubRef.current?.();
      unsubRef.current = subscribeItems(centerId, () => void refreshSafe());
    } catch (e) {
      console.warn('[RECOVER] resubscribe realtime failed', e);
    }

    // refresh datos sí o sí
    await refreshSafe();
    console.log('[RECOVER] done');
  } finally {
    setTimeout(() => {
      rejoinBusyRef.current = false;
    }, 800);
  }
};

  const onVis = () => {
    if (document.visibilityState === 'visible') void rejoin();
  };

  window.addEventListener('focus', rejoin);
  window.addEventListener('online', rejoin);
  document.addEventListener('visibilitychange', onVis);

  return () => {
    alive = false;

    window.removeEventListener('focus', rejoin);
    window.removeEventListener('online', rejoin);
    document.removeEventListener('visibilitychange', onVis);

    clearInterval(poll);

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

  const prevWeek = () => setWeekStart((d) => addDays(d, -7));
  const nextWeek = () => setWeekStart((d) => addDays(d, +7));
  const goToday = () => setWeekStart(startOfWeekMonday(new Date()));

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
  if (idx <= 0) return;
  const destDay = dayKeys[idx - 1];
  try {
    await updateItem(it.id, { day: destDay } as any);
    await refresh();
  } catch (e) {
    showErr(e);
  }
};

const moveDayRight = async (it: Item) => {
  const idx = dayKeys.indexOf(it.day);
  if (idx < 0 || idx >= dayKeys.length - 1) return;
  const destDay = dayKeys[idx + 1];
  try {
    await updateItem(it.id, { day: destDay } as any);
    await refresh();
  } catch (e) {
    showErr(e);
  }
};

function getActiveDayISO(): string {
  const today = new Date();
  const day = today.getDay(); // 0=Dom, 6=Sáb

  // Si es sábado (6) → lunes siguiente (+2)
  // Si es domingo (0) → lunes siguiente (+1)
  if (day === 6) {
    today.setDate(today.getDate() + 2);
  } else if (day === 0) {
    today.setDate(today.getDate() + 1);
  }

  return today.toISOString().slice(0, 10); // YYYY-MM-DD
}
function formatDateES(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

  return (
  <div className="flex flex-col gap-3">
    <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      {/* IZQUIERDA: navegación semana + solo visualización para editor*/}
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-lg border hover:bg-gray-50" title="Semana anterior" onClick={prevWeek}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button className="p-2 rounded-lg border hover:bg-gray-50" title="Semana siguiente" onClick={nextWeek}>
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm flex items-center gap-2"
          onClick={goToday}
        >
          <Calendar className="w-4 h-4" />
          Hoy
        </button>
      </div>

       {role === 'editor' && (
  <button
    type="button"
    onClick={() => setReadOnly((v) => !v)}
    className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border bg-white hover:bg-gray-50"
    title={readOnly ? 'Quitar modo solo lectura' : 'Activar modo solo lectura'}
  >
    <span className="text-xs text-gray-600">Solo lectura</span>

    {/* Switch */}
    <span
      className={[
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        readOnly ? 'bg-emerald-600' : 'bg-gray-300',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          readOnly ? 'translate-x-5' : 'translate-x-1',
        ].join(' ')}
      />
    </span>
  </button>
)}

      {/* DERECHA: buscador + export  */}
      <div className="flex items-center gap-2 w-full md:w-auto md:ml-auto">
        
        {/* Buscador (siempre visible) */}
        <input
          className="border rounded-lg px-3 py-2 text-sm w-full md:w-[260px]"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Export SOLO editor */}
        {effectiveRole === 'editor' && (
          <>
            <select
              className="border rounded-lg px-2 py-2 text-sm bg-white"
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as ExportMode)}
              title="Rango exportación"
            >
              <option value="all">Todo</option>
              <option value="today">Hoy</option>
              <option value="week">Esta semana</option>
              <option value="range">Período</option>
            </select>

            {exportMode === 'range' && (
              <>
                <input
                  type="date"
                  className="border rounded-lg px-2 py-2 text-sm"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="border rounded-lg px-2 py-2 text-sm"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </>
            )}

            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm flex items-center gap-2"
              onClick={() => void exportCSV()}
              title="Exportar CSV"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </>
        )}
      </div>
    </div>

    {/* ... aquí sigue tu grid etc ... */}

      <div
  className={[
    "grid gap-2",
    isMobilePortrait
      ? "grid-cols-[80px_minmax(0,1fr)]"
      : "grid-cols-[80px_repeat(5,minmax(0,1fr))]",
  ].join(" ")}
>
<div className="flex items-center">
  <select
    className="w-full border rounded-lg px-2 py-1 text-xs bg-white"
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

  {visibleDayKeys.map((dk, idx) => {
  const isToday = dk === activeDayKey;

  return (
    <div
      key={dk}
      className={[
        'text-xs font-semibold text-center rounded-lg py-1 border',
        isToday
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : 'text-gray-500 border-transparent',
      ].join(' ')}
    >
      <div>{weekdayES(dk)}</div>
      <div className="text-[11px] font-normal text-gray-400">{formatDateES(dk)}</div>
    </div>
  );
})}

  {/* aquí ya siguen tus RowBlock(...) */}


        {visibleRows.map((row) => (
          <RowBlock
            key={row}
            role={effectiveRole}
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
          />
        ))}
      </div>
    </div>
  );
}
function RowBlock({
  role,
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
  procs,
  activeDayKey
}: any) {
  const Chip = ({ children, tone = 'gray' }: { children: any; tone?: 'gray' | 'green' }) => (
    <span
      className={[
        'inline-flex items-center px-2 py-1 rounded-md text-xs border',
        tone === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-700',
      ].join(' ')}
    >
      {children}
    </span>
  );

  return (
    <>
      <div className="border rounded-lg p-2 text-sm font-semibold bg-gray-50">{row}</div>

      {dayKeys.map((dk: string) => {
        const cellKey = `${dk}__${row}`;
        const cell = byCell.get(cellKey) ?? [];
        const isDraftHere = draftCell?.day === dk && draftCell?.row === row;
        const isActiveDay = dk === activeDayKey;
        const isToday = dk === activeDayKey;

        return (
          <div
            key={cellKey}
          className={[
  'border rounded-lg p-2 min-h-[120px] flex flex-col gap-2',
  isToday ? 'bg-rose-50/40 border-rose-200' : 'bg-white',
].join(' ')}
          >
            {/* Botón "Añadir paciente" solo si no hay editor abierto */}
            {role === 'editor' && !isDraftHere && (
              <button
                className="w-full flex items-center justify-center gap-2 border rounded-lg py-2 text-sm hover:bg-gray-50 bg-white"
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
    ? 'bg-gray-100 border-gray-200 opacity-80'
    : 'bg-white'
].join(' ')}
                >
                 {/* Barra de comandos (puede envolver a 2 líneas) */}
<div className="flex flex-wrap items-center justify-between gap-2">
  <div className="flex items-center gap-2">
    <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs text-gray-700 bg-white">
      {ordNum}
    </div>

    {/* ✅ Hecho: visible y clicable también en viewer */}
    <button className="p-1 rounded hover:bg-gray-100" title="Hecho" onClick={() => doToggleDone(it)}>
      {it.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
    </button>

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
                  <div className="mt-2 text-sm font-semibold break-words">{it.name}</div>

                  {/* Chips */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {it.dx ? <Chip>Dx: {it.dx}</Chip> : null}                    
                    {it.room ? <Chip>Hab: {it.room}</Chip> : null}
                    {it.proc ? (() => {
  const meta = procs.find((p: ProcDef) => p.name === it.proc);
  const bg = meta?.color_bg ?? '#EEF2FF';   // fallback suave
  const fg = meta?.color_text ?? '#1F2937';
  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border"
      style={{ backgroundColor: bg, color: fg, borderColor: 'rgba(0,0,0,0.10)' }}
    >
      {String(it.proc)}
    </span>
  );
})() : null}
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