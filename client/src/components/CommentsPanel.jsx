// Comments panel (spec section 27).
import { useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Empty, Avatar, Icon } from './ui.jsx';
import { fmtRelative } from '../utils.js';

export default function CommentsPanel({ ownerType, ownerId, comments, onChanged, title = 'Comments' }) {
  const { user } = useAuth();
  const { show } = useToast();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      await api.post('/comments', { ownerType, ownerId, message: message.trim() });
      setMessage('');
      onChanged?.();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const rows = [...(comments || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '';

  return (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? <Empty icon="comment" title="No comments yet" hint="Start the discussion below." /> : (
        <div className="mb-16">
          {rows.map((c) => (
            <div className="comment" key={c.id}>
              <Avatar name={c.userName || '?'} />
              <div className="body">
                <div className="who">{c.userName || 'Unknown'}</div>
                <div className="msg">{c.message}</div>
                <div className="when">{fmtRelative(c.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex">
        <Avatar name={fullName} />
        <input
          className="input"
          placeholder="Write a comment…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
          <Icon name="comment" size={14} /> Send
        </button>
      </form>
    </Card>
  );
}
