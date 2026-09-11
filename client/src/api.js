// Minimal API client: Bearer token auth, JSON in/out, friendly errors.
const TOKEN_KEY = 'mam_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, formData, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError('Cannot reach the server. Check that it is running.', 0);
  }

  if (res.status === 204) return null;
  if (raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return res;
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Request failed (${res.status})`;
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      setToken('');
      window.dispatchEvent(new CustomEvent('mam:unauthorized'));
    }
    throw new ApiError(message, res.status, data?.error?.details);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, { formData }),
  rawRequest: request,
  /** Download a CSV report (adds the auth header, saves to a file). */
  async downloadCsv(path, filename) {
    const res = await request('GET', path, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** URL for an attachment download / inline preview (auth via query because <img>/<a> cannot send headers). */
  fileUrl(attachmentId, inline) {
    return `/api/attachments/${attachmentId}/${inline ? 'preview' : 'download'}?token=${encodeURIComponent(getToken())}`;
  }
};
