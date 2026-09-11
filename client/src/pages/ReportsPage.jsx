// Reports & analysis with CSV export (spec sections 36-39).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty } from '../components/ui.jsx';
import { classNames } from '../utils.js';

function cellText(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function ReportsPage() {
  const { show } = useToast();
  const [reports, setReports] = useState(null);
  const [active, setActive] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const rows = await api.get('/reports');
      setReports(rows);
      if (rows.length > 0) setActive((prev) => prev || rows[0].key);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setData(null);
    api.get(`/reports/${active}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [active]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      await api.downloadCsv(`/reports/${active}?format=csv`, `${active}.csv`);
      show('CSV exported', 'success');
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const currentMeta = (reports || []).find((r) => r.key === active);
  const columns = data?.columns || currentMeta?.columns || [];

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Reports</h1>
          <div className="sub">Machine, project, workload and quality analysis — exportable to CSV / Excel</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={exportCsv} disabled={!active || busy || !data}>
          <Icon name="download" size={15} /> {busy ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!reports ? <Loading /> : reports.length === 0 ? <Empty icon="reports" title="No reports available" /> : (
        <>
          <div className="report-picker">
            {reports.map((r) => (
              <button
                key={r.key}
                type="button"
                className={classNames('report-chip', r.key === active && 'active')}
                onClick={() => setActive(r.key)}
              >
                {r.title}
              </button>
            ))}
          </div>

          <Card
            title={data?.title || currentMeta?.title || 'Report'}
            actions={<span className="small muted">{data ? `${data.rows?.length || 0} row(s)` : ''}</span>}
            bodyClass="card-body tight"
          >
            {!data ? <Loading /> : (data.rows || []).length === 0 ? (
              <Empty icon="reports" title="No data for this report yet" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.key} className={typeof row[c.key] === 'number' ? 'num' : ''}>
                            {cellText(row[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
