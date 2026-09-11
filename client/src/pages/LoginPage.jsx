// Login screen with demo-account shortcuts.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Icon, Field } from '../components/ui.jsx';

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', label: 'Admin' },
  { username: 'mohamed', password: 'mohamed123', label: 'Engineer' },
  { username: 'ahmed', password: 'ahmed123', label: 'Technician' }
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <div className="logo">
            <Icon name="tools" size={26} />
          </div>
          <h2>Machine Assembly Manager</h2>
          <p className="muted small">
            Assembly · Refurbishment · Replacement — sign in to continue
          </p>
        </div>
        <div className="login-body">
          {error ? <div className="error-block">{error}</div> : null}
          <Field label="Username">
            <input
              className="input"
              value={username}
              autoComplete="username"
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. ahmed"
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-lg btn-block mt-8" disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-hint">
            <div className="strong mb-8">Demo accounts (seeded data)</div>
            {DEMO_ACCOUNTS.map((acc) => (
              <div key={acc.username} className="flex between" style={{ marginBottom: 3 }}>
                <span>{acc.label}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setUsername(acc.username); setPassword(acc.password); }}
                >
                  {acc.username} / {acc.password}
                </button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
