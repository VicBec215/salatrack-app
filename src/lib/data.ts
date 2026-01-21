// src/lib/data.ts
import { supabase } from './supabaseClient';
import { RowKey, ProcKey } from './date';

export type Item = {
  id: string;
  center_id: string; // ✅ NUEVO
  name: string;
  room: string;
  dx: string;
  proc: ProcKey;
  day: string;   // 'YYYY-MM-DD'
  row: RowKey;   // 'Sala 1' | 'Sala 2' | 'Sala 3' | 'Tarde'
  ord: number;   // orden libre (puede tener huecos)
  done: boolean;
  created_at?: string;
  created_by?: string | null;
};

/** Obtiene center_id a partir de slug */
export async function getCenterIdBySlug(centerSlug: string): Promise<string> {
  const { data, error } = await supabase
    .from('centers')
    .select('id')
    .eq('slug', centerSlug)
    .single();

  if (error) throw error;
  return data.id as string;
}

/** ord máximo en (center_id, day, row); 0 si no hay filas */
export async function getMaxOrd(centerId: string, day: string, row: RowKey): Promise<number> {
  const { data, error } = await supabase
    .from('items')
    .select('ord')
    .eq('center_id', centerId)
    .eq('day', day)
    .eq('row', row)
    .order('ord', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.ord ?? 0;
}

/** ord mínimo en (center_id, day, row); 1 si no hay filas (para que min-1 = 0 funcione) */
export async function getMinOrd(centerId: string, day: string, row: RowKey): Promise<number> {
  const { data, error } = await supabase
    .from('items')
    .select('ord')
    .eq('center_id', centerId)
    .eq('day', day)
    .eq('row', row)
    .order('ord', { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.ord ?? 1;
}

/**
 * Lista la semana (L-V) para un centro
 * mondayISO = 'YYYY-MM-DD'
 */
export async function listWeek(centerId: string, mondayISO: string) {
  const monday = new Date(mondayISO);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const fridayISO = friday.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('items')
    .select('id, center_id, name, room, dx, proc, day, row, ord, done')
    .eq('center_id', centerId)
    .gte('day', mondayISO)
    .lte('day', fridayISO)
    .order('day', { ascending: true })
    .order('row', { ascending: true })
    .order('ord', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function addItem(input: {
  center_id: string; // ✅ obligatorio
  name?: string;
  room?: string;
  dx?: string;
  proc: ProcKey;
  day: string;
  row: RowKey;
  done?: boolean; // por defecto false
}) {
  const max = await getMaxOrd(input.center_id, input.day, input.row);

  const { data, error } = await supabase
    .from('items')
    .insert([
      {
        center_id: input.center_id,
        name: input.name ?? '',
        room: input.room ?? '',
        dx: input.dx ?? '',
        proc: input.proc,
        day: input.day,
        row: input.row,
        ord: max + 10, // inserta al final de la celda
        done: input.done ?? false,
      },
    ])
    .select()
    .maybeSingle();

  if (error) throw error;
  return data as Item;
}

// updateItem: opcionalmente puedes pasar center_id para forzar seguridad en cliente.
// En BD ya te protege RLS por center_id.
export async function updateItem(id: string, patch: any) {
  const { error } = await supabase.from('items').update(patch).eq('id', id);

  if (error) {
    // ❌ quita alert aquí
    console.error(error);
    throw error;
  }
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) {
    console.error(error);
    throw error;
  }
}

/**
 * Realtime por centro (filtra por center_id)
 * Devuelve función de unsubscribe
 */
export function subscribeItems(centerId: string, onChange: () => void) {
  const channel = supabase
    .channel(`items-${centerId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items', filter: `center_id=eq.${centerId}` },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Rol por centro:
 * - unknown: no autenticado
 * - editor: role in ('editor','admin')
 * - viewer: miembro pero no editor, o no miembro
 */
export async function getMyRole(centerSlug: string): Promise<'editor' | 'viewer' | 'unknown'> {
  // ✅ getSession es local y no depende de red
  const { data: s } = await supabase.auth.getSession();
  const user = s.session?.user;
  if (!user) return 'unknown';

  // ✅ 1 sola query (join) en vez de 2
  const { data, error } = await supabase
    .from('center_members')
    .select('role, centers!inner(slug)')
    .eq('user_id', user.id)
    .eq('centers.slug', centerSlug)
    .maybeSingle();

  if (error) throw error;

  const role = String(data?.role ?? 'viewer').toLowerCase();
  return role === 'admin' || role === 'editor' ? 'editor' : 'viewer';
}