// My profile: personal info + password change (spec section 32).
import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Field, Avatar } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';

export default function ProfilePage() {
  const { user, logout, meta } = useAuth();
  const { show } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '';

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (next !== confirmPw) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      show('Password changed', 'success');
      setCurrent(''); setNext(''); setConfirmPw('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>My profile</h1>
          <div className="sub">Your account and password</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={logout}>
          <Icon name="logout" size={14} /> Sign out
        </button>
      </div>

      <div className="grid grid-2">
        <Card title="Account">
          <div className="flex mb-16" style={{ gap: 14 }}>
            <Avatar name={fullName} large />
            <div>
              <div className="strong" style={{ fontSize: 16 }}>{fullName}</div>
              <div className="small muted">@{user?.username}</div>
            </div>
          </div>
          <dl className="def-list">
            <dt>Roles</dt>
            <dd>
              <div className="flex flex-wrap" style={{ gap: 4 }}>
                {(user?.roles || []).map((r) => <span className="badge badge-slate" key={r.id}>{r.name}</span>)}
              </div>
            </dd>
            <dt>Email</dt><dd>{user?.email || '—'}</dd>
            <dt>Phone</dt><dd>{user?.phone || '—'}</dd>
            <dt>Department</dt><dd>{user?.departmentName || refDepartment(meta, user) || '—'}</dd>
            <dt>Last login</dt><dd>{user?.lastLogin ? fmtDateTime(user.lastLogin) : '—'}</dd>
          </dl>
        </Card>

        <Card title="Change password">
          <form onSubmit={changePassword} style={{ maxWidth: 420 }}>
            {error ? <div className="error-block">{error}</div> : null}
            <Field label="Current password">
              <input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 6 characters.">
              <input type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <input type="password" className="input" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !current || !next}>
              <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Change password'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

// Department name is resolved from the auth meta when available.
function refDepartment() {
  return null;
}
