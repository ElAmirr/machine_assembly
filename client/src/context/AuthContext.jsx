// Auth + catalogs (meta) context. Loads /auth/me and /meta once after login.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [meta, setMeta] = useState(null);
  const [ready, setReady] = useState(false);

  const loadSession = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const [me, metaData] = await Promise.all([api.get('/auth/me'), api.get('/meta')]);
      setUser(me.user);
      setPermissions(me.permissions || []);
      setMeta(metaData);
    } catch {
      setToken('');
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Global 401 handler from the api client.
  useEffect(() => {
    const onUnauthorized = () => { setUser(null); setPermissions([]); };
    window.addEventListener('mam:unauthorized', onUnauthorized);
    return () => window.removeEventListener('mam:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await api.post('/auth/login', { username, password });
    setToken(result.token);
    setUser(result.user);
    setPermissions(result.permissions || []);
    const metaData = await api.get('/meta');
    setMeta(metaData);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken('');
    setUser(null);
    setPermissions([]);
  }, []);

  const refreshMeta = useCallback(async () => {
    try { setMeta(await api.get('/meta')); } catch { /* ignore */ }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me.user);
      setPermissions(me.permissions || []);
    } catch { /* ignore */ }
  }, []);

  const hasPermission = useCallback((key) => {
    if (!key) return true;
    if (Array.isArray(key)) return key.some((k) => permissions.includes('*') || permissions.includes(k));
    return permissions.includes('*') || permissions.includes(key);
  }, [permissions]);

  const value = useMemo(() => ({
    user, permissions, meta, ready, login, logout, hasPermission, refreshMeta, refreshUser
  }), [user, permissions, meta, ready, login, logout, hasPermission, refreshMeta, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Convenience: label for a status key using the loaded meta catalogs. */
export function useStatusLabels() {
  const { meta } = useAuth();
  return useMemo(() => {
    const maps = { project: {}, task: {}, step: {} };
    for (const kind of Object.keys(maps)) {
      for (const s of meta?.statuses?.[kind] || []) maps[kind][s.key] = s.label;
    }
    const priorities = {};
    for (const p of meta?.priorities || []) priorities[p.key] = p.label;
    const units = {};
    for (const u of meta?.durationUnits || []) units[u.key] = u.label;
    return {
      statusLabel: (kind, key) => maps[kind]?.[key] || key || '—',
      priorityLabel: (key) => priorities[key] || key || '—',
      unitLabel: (key) => units[key] || key || '',
      maps, priorities, units
    };
  }, [meta]);
}
