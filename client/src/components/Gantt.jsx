// Simple custom Gantt: one row per task, bars from planned dates (spec section 24).
import { useMemo } from 'react';
import { classNames, fmtDate } from '../utils.js';

const DAY = 24 * 3600 * 1000;
const DAY_W = 30;

function dayCount(a, b) {
  return Math.max(1, Math.round((b - a) / DAY) + 1);
}

export default function Gantt({ tasks, onOpen, labelWidth = 260 }) {
  const model = useMemo(() => {
    const rows = (tasks || [])
      .map((t) => ({
        task: t,
        start: t.plannedStart ? new Date(t.plannedStart).getTime() : null,
        end: t.plannedEnd ? new Date(t.plannedEnd).getTime() : null,
        actualStart: t.actualStart ? new Date(t.actualStart).getTime() : null,
        actualEnd: t.actualEnd ? new Date(t.actualEnd).getTime() : null
      }))
      .filter((r) => r.start && r.end);

    if (rows.length === 0) return null;

    let min = Math.min(...rows.map((r) => Math.min(r.start, r.actualStart || r.start)));
    let max = Math.max(...rows.map((r) => Math.max(r.end, r.actualEnd || r.end)));
    min -= 2 * DAY;
    max += 2 * DAY;

    const days = [];
    const todayKey = new Date().toISOString().slice(0, 10);
    let cursor = min;
    while (cursor <= max && days.length < 400) {
      const d = new Date(cursor);
      const dow = d.getDay();
      days.push({
        key: d.toISOString().slice(0, 10),
        day: d.getDate(),
        dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dow],
        weekend: dow === 0 || dow === 6,
        today: d.toISOString().slice(0, 10) === todayKey
      });
      cursor += DAY;
    }

    return { rows, min, days };
  }, [tasks]);

  if (!model) {
    return <div className="empty">No planned dates yet — set task start/end dates to see the timeline.</div>;
  }

  const { rows, min, days } = model;
  const todayIndex = days.findIndex((d) => d.today);

  return (
    <div className="gantt-wrap">
      <div className="gantt">
        <div className="gantt-header" style={{ display: 'flex' }}>
          <div className="gantt-left-head" style={{ width: labelWidth }}>Task</div>
          <div className="gantt-days">
            {days.map((d) => (
              <div key={d.key} className={classNames('gantt-day', d.weekend && 'weekend', d.today && 'today')}>
                <span className="dow">{d.dow}</span>{d.day}
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          {todayIndex >= 0 ? (
            <div className="gantt-today-line" style={{ left: labelWidth + todayIndex * DAY_W + DAY_W / 2 }} />
          ) : null}

          {rows.map(({ task, start, end, actualStart, actualEnd }) => {
            const offset = Math.round((start - min) / DAY) * DAY_W;
            const width = Math.max(1, dayCount(start, end)) * DAY_W - 4;
            const done = task.status === 'completed' || task.status === 'approved';
            const late = !done && end < Date.now();
            const blocked = task.status === 'blocked' || task.computed?.blockedBy?.length > 0;
            const cls = done ? 'done' : late ? 'late' : blocked ? 'blocked' : task.status === 'in_progress' ? '' : 'plan';
            const title = `${task.name}\n${fmtDate(task.plannedStart)} → ${fmtDate(task.plannedEnd)}${task.assignedName ? `\n${task.assignedName}` : ''}`;
            return (
              <div key={task.id} className="gantt-row">
                <div className="gantt-left" style={{ width: labelWidth, cursor: onOpen ? 'pointer' : undefined }} onClick={() => onOpen?.(task)}>
                  <div className="t" title={task.name}>{task.order ? `${task.order}. ` : ''}{task.name}</div>
                  <div className="s">{task.assignedName || task.roleName || '—'}</div>
                </div>
                <div className="gantt-lane" style={{ width: days.length * DAY_W }}>
                  {days.map((d) => <div key={d.key} className={classNames('gantt-cell', d.weekend && 'weekend', d.today && 'today')} />)}
                  <div className={classNames('gantt-bar', cls)} style={{ left: offset, width }} title={title} onClick={() => onOpen?.(task)}>
                    {task.progress > 0 && !done ? `${task.progress}%` : task.name}
                  </div>
                  {actualStart && actualEnd ? (
                    <div
                      className="gantt-bar"
                      style={{
                        top: '60%', height: '22%', background: '#0e7490', opacity: 0.75,
                        left: Math.round((actualStart - min) / DAY) * DAY_W,
                        width: Math.max(1, dayCount(actualStart, actualEnd)) * DAY_W - 4
                      }}
                      title={`Actual: ${fmtDate(task.actualStart)} → ${fmtDate(task.actualEnd)}`}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
