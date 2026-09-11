// Attachments panel (spec section 13): upload, download/preview, new version, delete.
import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Icon, Empty, AuthImage } from './ui.jsx';
import { fmtBytes, fmtDateTime, fmtRelative } from '../utils.js';

function isImage(att) {
  return String(att.mimeType || '').startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(String(att.ext || '').toLowerCase());
}

export default function AttachmentsPanel({ ownerType, ownerId, attachments, onChanged, title = 'Files & attachments' }) {
  const { user, hasPermission, meta } = useAuth();
  const { show, confirm } = useToast();
  const uploadRef = useRef(null);
  const replaceRef = useRef(null);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);

  const canUpload = hasPermission('attachments.upload');
  const canManageAny = hasPermission(['*', 'attachments.manage']);
  const maxMb = meta?.maxUploadMb || 50;

  const doUpload = async (file) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      show(`File is too large (max ${maxMb} MB)`, 'error');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      await api.upload('/attachments', fd);
      show('File uploaded', 'success');
      onChanged?.();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doReplace = async (file) => {
    if (!file || !replaceTarget) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload(`/attachments/${replaceTarget.id}/replace`, fd);
      show('New version uploaded', 'success');
      setReplaceTarget(null);
      onChanged?.();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (att) => {
    const ok = await confirm({
      title: 'Delete file?',
      message: `"${att.filename}" will be permanently deleted${att.version > 1 ? ' (all versions of this file item are affected only for this version)' : ''}.`,
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del(`/attachments/${att.id}`);
      show('File deleted', 'success');
      onChanged?.();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const rows = [...(attachments || [])].sort((a, b) =>
    String(b.uploadedAt || b.createdAt).localeCompare(String(a.uploadedAt || a.createdAt)));

  return (
    <Card
      title={title}
      actions={(
        <>
          <span className="small muted">{rows.length} file(s)</span>
          {canUpload ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => uploadRef.current?.click()}>
              <Icon name="upload" size={14} /> Upload
            </button>
          ) : null}
        </>
      )}
    >
      <input
        ref={uploadRef} type="file" style={{ display: 'none' }}
        onChange={(e) => { doUpload(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={replaceRef} type="file" style={{ display: 'none' }}
        onChange={(e) => { doReplace(e.target.files?.[0]); e.target.value = ''; }}
      />

      {canUpload ? (
        <div
          className={`upload-drop mb-16${drag ? ' drag' : ''}`}
          onClick={() => uploadRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files?.[0]); }}
        >
          <Icon name="upload" size={18} />
          <div className="mt-8">Drop a file here or click to upload (max {maxMb} MB)</div>
          <div className="small">PDF, images, Office documents, drawings, archives…</div>
        </div>
      ) : null}

      {rows.length === 0 ? <Empty icon="file" title="No files yet" /> : (
        <div>
          {rows.map((att) => (
            <div className="evidence-item" key={att.id}>
              <div className="evidence-thumb">
                {isImage(att) ? <AuthImage attachmentId={att.id} alt={att.filename} /> : <Icon name="file" size={20} />}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong" style={{ overflowWrap: 'anywhere' }}>
                  {att.filename}
                  {att.version > 1 ? <span className="badge badge-blue" style={{ marginLeft: 7 }}>v{att.version}</span> : null}
                </div>
                <div className="small muted">
                  {fmtBytes(att.size)} · uploaded by {att.uploadedByName || '—'} · {fmtRelative(att.uploadedAt || att.createdAt)}
                </div>
                {att.description ? <div className="small mt-8">{att.description}</div> : null}
              </div>
              <div className="flex" style={{ flexShrink: 0 }}>
                {isImage(att) ? (
                  <button type="button" className="icon-btn" title="Preview" onClick={() => setPreview(att)}>
                    <Icon name="eye" size={15} />
                  </button>
                ) : null}
                <a className="icon-btn" title="Download" href={api.fileUrl(att.id, false)}>
                  <Icon name="download" size={15} />
                </a>
                {canUpload && (canManageAny || att.uploadedBy === user?.id) ? (
                  <>
                    <button type="button" className="icon-btn" title="Upload new version" onClick={() => { setReplaceTarget(att); replaceRef.current?.click(); }}>
                      <Icon name="refresh" size={15} />
                    </button>
                    <button type="button" className="icon-btn" title="Delete" onClick={() => remove(att)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview ? (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="modal modal-xl">
            <div className="modal-header">
              <h3>{preview.filename}</h3>
              <button type="button" className="icon-btn" onClick={() => setPreview(null)}><Icon name="x" /></button>
            </div>
            <div className="modal-body center">
              <img src={api.fileUrl(preview.id, true)} alt={preview.filename} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} />
              <div className="small muted mt-8">{fmtDateTime(preview.uploadedAt || preview.createdAt)}</div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
