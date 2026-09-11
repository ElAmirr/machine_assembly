// Machines overview: every machine with its full project history (spec sections 5, 21).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Icon, Loading, ErrorBlock, Empty, StatusBadge } from '../components/ui.jsx';
import { fmtDate } from '../utils.js';

export default function MachinesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    try {
      setRows(await api.get('/machines'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const term = q.trim().toLowerCase();
  const filtered = (rows || []).filter((m) =>
    !term || [m.machineName, m.machineReference, m.machineSerial].some((v) => String(v || '').toLowerCase().includes(term))
  );

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Machines</h1>
          <div className="sub">{rows ? `${rows.length} machine(s) registered across all projects` : 'Machine registry and history'}</div>
        </div>
        <div className="search-input-wrap" style={{ width: 280 }}>
          <Icon name="search" size={15} />
          <input className="input" placeholder="Search machine or reference…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!rows ? <Loading /> : filtered.length === 0 ? (
        <Empty icon="machines" title="No machines found" hint="Machines appear here as soon as they are used in a project." />
      ) : (
        <Card bodyClass="card-body tight">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Machine</th>
                  <th>Reference / serial</th>
                  <th>Projects</th>
                  <th>Latest status</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const key = m.machineReference || m.machineName;
                  const open = !!expanded[key];
                  const last = m.lastProject;
                  return [
                    <tr key={key} className="clickable" onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))}>
                      <td className="actions"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} /></td>
                      <td className="strong">{m.machineName}</td>
                      <td className="muted nowrap">
                        {m.machineReference || '—'}
                        {m.machineSerial ? <div className="small">SN {m.machineSerial}</div> : null}
                      </td>
                      <td><span className="badge badge-slate">{m.projectsCount} project(s)</span></td>
                      <td><StatusBadge status={last?.status} /></td>
                      <td className="small muted nowrap">{fmtDate(last?.startDate)} → {last?.actualEndDate ? fmtDate(last.actualEndDate) : 'ongoing'}</td>
                    </tr>,
                    open ? (
                      <tr key={`${key}-detail`}>
                        <td />
                        <td colSpan={5}>
                          <table className="table" style={{ margin: '4px 0' }}>
                            <thead>
                              <tr>
                                <th>Project</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Progress</th>
                                <th>Start</th>
                                <th>Planned end</th>
                                <th>Actual end</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {m.projects.map((p) => (
                                <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                                  <td className="strong">{p.code}</td>
                                  <td className="muted">{p.typeName || '—'}</td>
                                  <td><StatusBadge status={p.status} /></td>
                                  <td className="muted">{p.progress || 0}%</td>
                                  <td className="small muted">{fmtDate(p.startDate)}</td>
                                  <td className="small muted">{fmtDate(p.plannedEndDate)}</td>
                                  <td className="small muted">{p.actualEndDate ? fmtDate(p.actualEndDate) : '—'}</td>
                                  <td className="actions"><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>Open</Link></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null
                  ];
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
