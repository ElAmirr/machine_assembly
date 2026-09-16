// Generic inventory page for components / tools (spec sections 17-18).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, Modal, Field } from '../components/ui.jsx';
import { classNames } from '../utils.js';

const KIND_CONFIG = {
  components: {
    path: '/components',
    label: 'Component',
    plural: 'Components',
    managePerm: 'components.manage',
    qtyFields: true,
    statuses: [{ key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }]
  },
  tools: {
    path: '/tools',
    label: 'Tool',
    plural: 'Tools',
    managePerm: 'tools.manage',
    qtyFields: true,
    statuses: [
      { key: 'available', label: 'Available' },
      { key: 'in_use', label: 'In use' },
      { key: 'maintenance', label: 'Maintenance' },
      { key: 'retired', label: 'Retired' }
    ]
  }
};

const statusTone = {
  active: 'badge-green', available: 'badge-green', in_use: 'badge-blue',
  maintenance: 'badge-amber', inactive: 'badge-slate', retired: 'badge-slate'
};

// Price and quantity are not used for now. Flip this to true to show them again in the
// Tools/Components pages - the stored data and the API keep supporting both in the meantime.
const SHOW_PRICE_QUANTITY = false;

function ItemModal({ cfg, item, onClose, onSaved }) {
  const { show } = useToast();
  const editing = !!item;
  const [form, setForm] = useState(() => ({
    name: item?.name || '',
    reference: item?.reference || '',
    partNumber: item?.partNumber || '',
    manufacturer: item?.manufacturer || '',
    supplier: item?.supplier || '',
    location: item?.location || '',
    description: item?.description || '',
    unit: item?.unit || '',
    quantity: item?.quantity ?? '',
    price: item?.price ?? '',
    status: item?.status || cfg.statuses[0].key
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(`${cfg.label} name is required.`); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        reference: form.reference,
        supplier: form.supplier,
        location: form.location,
        description: form.description,
        status: form.status
      };
      if (cfg.qtyFields) {
        payload.partNumber = form.partNumber;
        payload.manufacturer = form.manufacturer;
        if (SHOW_PRICE_QUANTITY) {
          payload.quantity = form.quantity === '' ? null : Number(form.quantity);
          payload.price = form.price === '' ? null : Number(form.price);
        }
        if (cfg.key === 'components') payload.unit = form.unit;
      }
      if (editing) await api.put(`${cfg.path}/${item.id}`, payload);
      else await api.post(cfg.path, payload);
      show(`${cfg.label} ${editing ? 'updated' : 'created'}`, 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${cfg.label.toLowerCase()}` : `New ${cfg.label.toLowerCase()}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : `Create ${cfg.label.toLowerCase()}`}
          </button>
        </>
      )}
    >
      <form id="item-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="input-row">
          <Field label="Name *" className="grow">
            <input className="input" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={set('status')}>
              {cfg.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="input-row">
          <Field label="Reference">
            <input className="input" value={form.reference} onChange={set('reference')} />
          </Field>
          {cfg.qtyFields ? (
            <>
              <Field label="Part number">
                <input className="input" value={form.partNumber} onChange={set('partNumber')} />
              </Field>
              <Field label="Manufacturer">
                <input className="input" value={form.manufacturer} onChange={set('manufacturer')} />
              </Field>
            </>
          ) : null}
        </div>
        <div className="input-row">
          {SHOW_PRICE_QUANTITY && cfg.qtyFields ? (
            <Field label="Quantity">
              <input type="number" step="any" className="input" value={form.quantity} onChange={set('quantity')} />
            </Field>
          ) : null}
          {SHOW_PRICE_QUANTITY ? (
            <Field label="Price">
              <input type="number" step="any" className="input" value={form.price} onChange={set('price')} />
            </Field>
          ) : null}
          <Field label="Storage location">
            <input className="input" value={form.location} onChange={set('location')} />
          </Field>
        </div>
        <div className="input-row">
          <Field label="Supplier">
            <input className="input" value={form.supplier} onChange={set('supplier')} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="textarea" rows="2" value={form.description} onChange={set('description')} />
        </Field>
      </form>
    </Modal>
  );
}

export default function InventoryPage({ kind }) {
  const cfg = { ...KIND_CONFIG[kind], key: kind };
  const { hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(null); // { item } | { item: null }

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (status) qs.set('status', status);
      setRows(await api.get(`${cfg.path}?${qs.toString()}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const canManage = hasPermission(cfg.managePerm);

  const remove = async (item) => {
    const ok = await confirm({
      title: `Delete ${cfg.label.toLowerCase()} "${item.name}"?`,
      message: 'Items used by tasks or templates cannot be deleted — deactivate them instead.',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del(`${cfg.path}/${item.id}`);
      show(`${cfg.label} deleted`, 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const statusBadge = (s) => <span className={classNames('badge', statusTone[s] || 'badge-slate')}>{cfg.statuses.find((x) => x.key === s)?.label || s || '—'}</span>;

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>{cfg.plural}</h1>
          <div className="sub">
            {rows ? `${rows.length} ${cfg.label.toLowerCase()}(s) in the catalog` : `Manage ${cfg.plural.toLowerCase()} used in workflows`}
          </div>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ item: null })}>
            <Icon name="plus" size={15} /> New {cfg.label.toLowerCase()}
          </button>
        ) : null}
      </div>

      <Card bodyClass="card-body">
        <div className="toolbar mb-16">
          <div className="search-input-wrap grow">
            <Icon name="search" size={15} />
            <input className="input" placeholder={`Search ${cfg.plural.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {cfg.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        {error ? <ErrorBlock message={error} /> : null}
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty icon={kind} title={`No ${cfg.plural.toLowerCase()} found`} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Reference</th>
                  {SHOW_PRICE_QUANTITY && cfg.qtyFields ? <th>Quantity</th> : null}
                  {SHOW_PRICE_QUANTITY ? <th>Price</th> : null}
                  <th>Location</th>
                  <th>Status</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="strong">{r.name}</div>
                        {r.partNumber ? <div className="small muted">P/N {r.partNumber}</div> : null}
                        {r.description ? <div className="small muted">{r.description}</div> : null}
                      </td>
                      <td className="muted nowrap">{r.reference || '—'}</td>
                      {SHOW_PRICE_QUANTITY && cfg.qtyFields ? <td className="muted">{r.quantity ?? '—'}</td> : null}
                      {SHOW_PRICE_QUANTITY ? <td className="muted">{r.price != null ? r.price : '—'}</td> : null}
                      <td className="muted">{r.location || '—'}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="actions">
                        {canManage ? (
                          <div className="flex" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <button type="button" className="icon-btn" title="Edit" onClick={() => setModal({ item: r })}><Icon name="edit" size={15} /></button>
                            <button type="button" className="icon-btn" title="Delete" onClick={() => remove(r)}><Icon name="trash" size={15} /></button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal ? (
        <ItemModal cfg={cfg} item={modal.item} onClose={() => setModal(null)} onSaved={load} />
      ) : null}
    </div>
  );
}
