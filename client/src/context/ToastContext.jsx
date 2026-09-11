// Tiny toast system: useToast().show('message', 'success'|'error'|'info')
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const dismiss = useCallback((id) => {
    setToasts((rows) => rows.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, type = 'info', ms = 4200) => {
    const id = ++seq;
    setToasts((rows) => [...rows, { id, message, type }]);
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  /** Promise-based confirm modal:  if (await confirm({ title, message, confirmLabel })) ... */
  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmState({
        title: options?.title || 'Are you sure?',
        message: options?.message || '',
        confirmLabel: options?.confirmLabel || 'Confirm',
        danger: options?.danger !== false,
        resolve
      });
    });
  }, []);

  const closeConfirm = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  const value = useMemo(() => ({ show, confirm }), [show, confirm]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)} role="alert">
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      {confirmState ? (
        <div className="modal-backdrop" onClick={() => closeConfirm(false)}>
          <div className="modal" style={{ maxWidth: 430 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{confirmState.title}</h3>
            </div>
            <div className="modal-body">
              <p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{confirmState.message}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => closeConfirm(false)}>Cancel</button>
              <button
                type="button"
                className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => closeConfirm(true)}
                autoFocus
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
