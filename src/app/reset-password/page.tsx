'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { X, Save } from 'lucide-react';

type Stage = 'checking' | 'ready' | 'done' | 'error';

export default function Page() {
  const [stage, setStage] = useState<Stage>('checking');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');

  // ✅ Evita que un build falle si falta env (Vercel Preview/Prod mal configurado)
  const env = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    return { url, anon, ok: Boolean(url && anon) };
  }, []);

  // ✅ Crea supabase client SOLO en cliente y SOLO si env está OK
  const supabase = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
  }, [env.ok, env.url, env.anon]);

  // Lee el hash del enlace (#access_token=...&refresh_token=...&type=recovery)
  const tokens = useMemo(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : '';
    const params = new URLSearchParams(h.startsWith('#') ? h.slice(1) : h);
    return {
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      type: params.get('type'),
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!env.ok || !supabase) {
          setErrorMsg(
            'Falta configuración de Supabase (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Revisa las variables de entorno en Vercel.'
          );
          setStage('error');
          return;
        }

        if (tokens.type !== 'recovery' || !tokens.access_token || !tokens.refresh_token) {
          setErrorMsg('Enlace inválido o caducado. Solicita un nuevo correo de recuperación.');
          setStage('error');
          return;
        }

        const { error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });

        if (error) throw error;
        setStage('ready');
      } catch (e: any) {
        setErrorMsg(e?.message || 'No se pudo validar el enlace.');
        setStage('error');
      }
    })();
  }, [tokens, env.ok, supabase]);

  const onSave = async () => {
    try {
      if (!env.ok || !supabase) {
        alert('Falta configuración de Supabase. Revisa variables de entorno en Vercel.');
        return;
      }

      if (!pwd || pwd.length < 8) {
        alert('La contraseña debe tener al menos 8 caracteres');
        return;
      }
      if (pwd !== pwd2) {
        alert('Las contraseñas no coinciden');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;

      setStage('done');

      // Cierra sesión (por seguridad) y limpia el hash
      await supabase.auth.signOut();

      // Limpia el hash del recovery
      window.history.replaceState({}, '', '/reset-password');

      // Vuelve al inicio
      window.location.assign('/');
    } catch (e: any) {
      alert(e?.message || 'No se pudo cambiar la contraseña');
    }
  };

  if (stage === 'checking') return <div className="p-6">Validando enlace…</div>;

  if (stage === 'error') {
    return (
      <div className="p-6 max-w-md">
        <div className="mb-2 font-semibold text-red-700">No se pudo validar el enlace</div>
        <div className="text-sm text-gray-700">{errorMsg}</div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="p-6 max-w-md">
        <div className="mb-2 font-semibold text-green-700">Contraseña actualizada</div>
        <div className="text-sm text-gray-700">
          Vuelve a la página principal e inicia sesión con tu nueva contraseña.
        </div>
      </div>
    );
  }

  // ready
  return (
    <div className="p-6 max-w-md">
      <div className="mb-3 font-semibold">Establece una nueva contraseña</div>

      <label className="block text-xs mb-2">
        Nueva contraseña
        <input
          type="password"
          className="mt-1 w-full border rounded px-2 py-1"
          autoComplete="new-password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
        />
      </label>

      <label className="block text-xs mb-4">
        Confirmar nueva contraseña
        <input
          type="password"
          className="mt-1 w-full border rounded px-2 py-1"
          autoComplete="new-password"
          value={pwd2}
          onChange={(e) => setPwd2(e.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <button className="px-3 py-1 rounded border bg-white text-sm" onClick={() => window.location.assign('/')}>
          <X className="inline w-4 h-4 mr-1" /> Cancelar
        </button>
        <button className="px-3 py-1 rounded border bg-white text-sm" onClick={onSave}>
          <Save className="inline w-4 h-4 mr-1" /> Guardar
        </button>
      </div>
    </div>
  );
}