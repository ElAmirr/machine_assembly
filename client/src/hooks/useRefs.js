// Loads reference data (people, departments, locations, project types, templates).
// Each endpoint degrades gracefully to [] when the current user lacks the permission.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { users: [], departments: [], locations: [], projectTypes: [], templates: [], roles: [] };

export function useRefs() {
  const [refs, setRefs] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const safe = (path, key) =>
      api.get(path).then((data) => ({ key, data })).catch(() => ({ key, data: [] }));
    const results = await Promise.all([
      safe('/users', 'users'),
      safe('/departments', 'departments'),
      safe('/locations', 'locations'),
      safe('/project-types', 'projectTypes'),
      safe('/workflow-templates?active=1', 'templates'),
      safe('/roles', 'roles')
    ]);
    const next = { ...EMPTY };
    for (const { key, data } of results) next[key] = Array.isArray(data) ? data : [];
    setRefs(next);
    setLoaded(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { refs, loaded, reload };
}

export function userName(users, id) {
  const u = (users || []).find((x) => x.id === id);
  return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username : null;
}

export function optionLabel(row) {
  return row.name || `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.username || row.id;
}
