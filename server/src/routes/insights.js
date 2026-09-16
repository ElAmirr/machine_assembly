// Dashboards (spec 19-21), Reports (spec 37), global search (spec 28), audit log viewer (spec 26).
import { Router } from 'express';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { buildLookups } from '../services/lookups.js';
import { isTaskDone, computeProjectProgress, computeTaskProgress, taskComputed } from '../services/projectService.js';
import { toCsv, fmtDate, daysBetween, durationToDays, str, asyncHandler } from '../utils.js';

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

const OPEN_PROJECT_STATUSES = ['planned', 'not_started', 'in_progress', 'waiting', 'blocked', 'validation'];
const OPEN_TASK_STATUSES = ['not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'submitted', 'rejected'];

async function loadWorld() {
  const [projects, tasks, lookups, approvals] = await Promise.all([
    collections.projects.all(), collections.tasks.all(), buildLookups(), collections.approvals.all()
  ]);
  return { projects, tasks, lookups, approvals };
}

function machineOf(project) {
  return project ? `${project.machineName}${project.machineReference ? ` (${project.machineReference})` : ''}` : '';
}

function isOverdue(t) {
  return !!t.plannedEnd && !isTaskDone(t) && new Date(t.plannedEnd).getTime() < Date.now();
}

// ------------------------------------------------------------ ADMIN DASHBOARD

insightsRouter.get('/dashboard/summary', requirePermission('projects.view'), asyncHandler(async (req, res) => {
  const { projects, tasks, lookups, approvals } = await loadWorld();
  const now = Date.now();
  const tasksByProject = new Map();
  for (const task of tasks) {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, []);
    tasksByProject.get(task.projectId).push(task);
  }

  const projectProgress = new Map(projects.map((p) => [p.id, computeProjectProgress(tasksByProject.get(p.id) || [])]));
  const delayedProjects = projects.filter((p) => p.plannedEndDate && !['completed', 'cancelled'].includes(p.status) && new Date(p.plannedEndDate).getTime() < now);
  const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));

  const countBy = (rows, key) => {
    const counts = {};
    for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
    return counts;
  };

  const typeCounts = countBy(projects, 'projectTypeId');
  const statusCounts = countBy(projects, 'status');
  const taskStatusCounts = countBy(tasks, 'status');

  const workloadByRole = {};
  for (const task of openTasks) {
    const name = lookups.roleById.get(task.roleId)?.name || 'Unassigned role';
    workloadByRole[name] = (workloadByRole[name] || 0) + 1;
  }
  const workloadByPerson = {};
  for (const task of openTasks) {
    if (!task.assignedUserId) continue;
    const name = lookups.userName(task.assignedUserId) || 'Unknown';
    workloadByPerson[name] = (workloadByPerson[name] || 0) + 1;
  }

  const durations = tasks
    .filter((t) => t.actualStart && t.actualEnd)
    .map((t) => (new Date(t.actualEnd) - new Date(t.actualStart)) / (24 * 3600 * 1000));
  const avgTaskDuration = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

  const plannedVsActual = tasks
    .filter((t) => t.actualStart && t.actualEnd)
    .slice(0, 30)
    .map((t) => ({
      name: t.name,
      planned: Math.round(durationToDays(t.estimatedDuration, t.durationUnit) * 10) / 10,
      actual: Math.round(((new Date(t.actualEnd) - new Date(t.actualStart)) / (24 * 3600 * 1000)) * 10) / 10
    }));

  const overallCompletion = projects.length
    ? Math.round([...projectProgress.values()].reduce((a, b) => a + b, 0) / projects.length)
    : 0;

  res.json({
    kpis: {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => OPEN_PROJECT_STATUSES.includes(p.status)).length,
      completedProjects: projects.filter((p) => p.status === 'completed').length,
      delayedProjects: delayedProjects.length,
      blockedProjects: projects.filter((p) => p.status === 'blocked').length,
      totalTasks: tasks.length,
      tasksInProgress: tasks.filter((t) => ['in_progress', 'rejected'].includes(t.status)).length,
      tasksOverdue: tasks.filter(isOverdue).length,
      tasksWaitingApproval: approvals.filter((a) => a.status === 'submitted').length,
      completedTasks: tasks.filter(isTaskDone).length,
      overallCompletion,
      avgTaskDurationDays: avgTaskDuration
    },
    projectsByType: lookups.projectTypes.map((t) => ({ name: t.name, value: typeCounts[t.id] || 0 })),
    projectsByStatus: (await import('../constants.js')).PROJECT_STATUSES.map((s) => ({ name: s.label, value: statusCounts[s.key] || 0 })),
    tasksByStatus: (await import('../constants.js')).TASK_STATUSES.map((s) => ({ name: s.label, value: taskStatusCounts[s.key] || 0 })),
    workloadByRole: Object.entries(workloadByRole).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    workloadByTechnician: Object.entries(workloadByPerson).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    plannedVsActual,
    completionByType: lookups.projectTypes.map((t) => {
      const rows = projects.filter((p) => p.projectTypeId === t.id);
      const avg = rows.length ? Math.round(rows.reduce((sum, p) => sum + (projectProgress.get(p.id) || 0), 0) / rows.length) : 0;
      return { name: t.name, value: avg };
    })
  });
}));

// ------------------------------------------------------------ MY DASHBOARD (technician/engineer)

insightsRouter.get('/dashboard/my', requirePermission('tasks.view'), asyncHandler(async (req, res) => {
  const { projects, tasks, lookups, approvals } = await loadWorld();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const mine = tasks.filter((t) =>
    t.assignedUserId === req.user.id || (t.steps || []).some((s) => s.assignedUserId === req.user.id)
  );
  const simplify = (t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    priority: t.priority,
    plannedEnd: t.plannedEnd,
    progress: computeTaskProgress(t),
    machineName: projectById.get(t.projectId)?.machineName || '',
    projectCode: projectById.get(t.projectId)?.code || '',
    projectId: t.projectId,
    roleName: lookups.roleById.get(t.roleId)?.name || null,
    overdue: isOverdue(t),
    stepsDone: (t.steps || []).filter((s) => s.status === 'completed').length,
    stepsTotal: (t.steps || []).length
  });

  const today = new Date().toISOString().slice(0, 10);
  const open = mine.filter((t) => !isTaskDone(t));
  const buckets = {
    dueToday: open.filter((t) => t.plannedEnd && String(t.plannedEnd).slice(0, 10) === today).map(simplify),
    overdue: open.filter(isOverdue).map(simplify),
    inProgress: open.filter((t) => ['in_progress', 'rejected'].includes(t.status)).map(simplify),
    waitingApproval: open.filter((t) => t.status === 'submitted').map(simplify),
    upNext: open
      .filter((t) => t.status === 'ready' || t.status === 'not_started')
      .map(simplify)
      .slice(0, 20),
    recentlyCompleted: mine
      .filter(isTaskDone)
      .sort((a, b) => String(b.actualEnd || '').localeCompare(String(a.actualEnd || '')))
      .slice(0, 10)
      .map(simplify)
  };

  const canReview = (req.permissions || []).includes('*') || (req.permissions || []).includes('approvals.approve');
  const toReview = canReview
    ? approvals.filter((a) => a.status === 'submitted').map((a) => ({
      ...a,
      machineName: projectById.get(a.projectId)?.machineName || '',
      submittedByName: lookups.userName(a.submittedBy)
    }))
    : [];

  res.json({
    counts: {
      open: open.length,
      dueToday: buckets.dueToday.length,
      overdue: buckets.overdue.length,
      inProgress: buckets.inProgress.length,
      waitingApproval: buckets.waitingApproval.length,
      toReview: toReview.length
    },
    buckets,
    approvalsToReview: toReview
  });
}));

// ------------------------------------------------------------ REPORTS

const REPORT_BUILDERS = {
  'project-progress': {
    title: 'Project progress',
    columns: [
      { key: 'code', label: 'Project' },
      { key: 'machineName', label: 'Machine' },
      { key: 'typeName', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'responsibleName', label: 'Responsible' },
      { key: 'startDate', label: 'Start', value: (r) => fmtDate(r.startDate) },
      { key: 'plannedEndDate', label: 'Planned end', value: (r) => fmtDate(r.plannedEndDate) },
      { key: 'actualEndDate', label: 'Actual end', value: (r) => fmtDate(r.actualEndDate) },
      { key: 'progress', label: 'Progress %' },
      { key: 'tasks', label: 'Tasks done', value: (r) => `${r.tasksDone}/${r.tasksTotal}` },
      { key: 'delay', label: 'Delayed', value: (r) => (r.overdue ? 'YES' : 'no') }
    ],
    build({ projects, tasks, lookups }) {
      return projects
        .map((p) => {
          const projectTasks = tasks.filter((t) => t.projectId === p.id);
          const now = Date.now();
          return {
            code: p.code,
            machineName: p.machineName,
            typeName: lookups.projectTypeById.get(p.projectTypeId)?.name || '',
            status: p.status,
            priority: p.priority,
            responsibleName: lookups.userName(p.responsibleUserId) || '',
            startDate: p.startDate,
            plannedEndDate: p.plannedEndDate,
            actualEndDate: p.actualEndDate,
            progress: computeProjectProgress(projectTasks),
            tasksDone: projectTasks.filter(isTaskDone).length,
            tasksTotal: projectTasks.length,
            overdue: !!p.plannedEndDate && !['completed', 'cancelled'].includes(p.status) && new Date(p.plannedEndDate).getTime() < now
          };
        })
        .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    }
  },
  'task-performance': {
    title: 'Task performance',
    columns: [
      { key: 'projectCode', label: 'Project' },
      { key: 'machineName', label: 'Machine' },
      { key: 'name', label: 'Task' },
      { key: 'roleName', label: 'Role' },
      { key: 'assignedName', label: 'Assigned to' },
      { key: 'status', label: 'Status' },
      { key: 'progress', label: 'Progress %' },
      { key: 'plannedEnd', label: 'Planned end', value: (r) => fmtDate(r.plannedEnd) },
      { key: 'actualEnd', label: 'Actual end', value: (r) => fmtDate(r.actualEnd) },
      { key: 'delayDays', label: 'Delay (days)' }
    ],
    build({ projects, tasks, lookups }) {
      const projectById = new Map(projects.map((p) => [p.id, p]));
      return tasks.map((t) => {
        const end = t.actualEnd ? new Date(t.actualEnd).getTime() : (t.plannedEnd && !isTaskDone(t) && new Date(t.plannedEnd).getTime() < Date.now() ? Date.now() : null);
        const delay = end && t.plannedEnd ? Math.max(0, Math.round((end - new Date(t.plannedEnd).getTime()) / (24 * 3600 * 1000))) : 0;
        return {
          projectCode: projectById.get(t.projectId)?.code || '',
          machineName: projectById.get(t.projectId)?.machineName || '',
          name: t.name,
          roleName: lookups.roleById.get(t.roleId)?.name || '',
          assignedName: lookups.userName(t.assignedUserId) || '',
          status: t.status,
          progress: computeTaskProgress(t),
          plannedEnd: t.plannedEnd,
          actualEnd: t.actualEnd,
          delayDays: delay
        };
      });
    }
  },
  'technician-performance': {
    title: 'People performance',
    columns: [
      { key: 'name', label: 'Person' },
      { key: 'roles', label: 'Roles' },
      { key: 'openTasks', label: 'Open tasks' },
      { key: 'completedTasks', label: 'Completed tasks' },
      { key: 'completedSteps', label: 'Completed steps' },
      { key: 'overdueTasks', label: 'Overdue tasks' },
      { key: 'avgCompletionDays', label: 'Avg completion (days)' }
    ],
    build({ tasks, lookups }) {
      return lookups.users.map((u) => {
        const assigned = tasks.filter((t) => t.assignedUserId === u.id);
        const done = assigned.filter(isTaskDone);
        const durations = done
          .filter((t) => t.actualStart && t.actualEnd)
          .map((t) => (new Date(t.actualEnd) - new Date(t.actualStart)) / (24 * 3600 * 1000));
        let completedSteps = 0;
        for (const task of tasks) {
          for (const step of task.steps || []) if (step.completedBy === u.id) completedSteps += 1;
        }
        const roleNames = lookups.roles.filter((r) => (u.roleIds || []).includes(r.id)).map((r) => r.name).join(', ');
        return {
          name: `${u.firstName} ${u.lastName}`.trim() || u.username,
          roles: roleNames,
          openTasks: assigned.filter((t) => !isTaskDone(t)).length,
          completedTasks: done.length,
          completedSteps,
          overdueTasks: assigned.filter(isOverdue).length,
          avgCompletionDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : ''
        };
      });
    }
  },
  delays: {
    title: 'Delays',
    columns: [
      { key: 'kind', label: 'Type' },
      { key: 'projectCode', label: 'Project' },
      { key: 'machineName', label: 'Machine' },
      { key: 'name', label: 'Item' },
      { key: 'assignedName', label: 'Responsible' },
      { key: 'plannedEnd', label: 'Planned end', value: (r) => fmtDate(r.plannedEnd) },
      { key: 'daysLate', label: 'Days late' },
      { key: 'status', label: 'Status' }
    ],
    build({ projects, tasks, lookups }) {
      const projectById = new Map(projects.map((p) => [p.id, p]));
      const rows = [];
      for (const t of tasks.filter(isOverdue)) {
        rows.push({
          kind: 'Task',
          projectCode: projectById.get(t.projectId)?.code || '',
          machineName: projectById.get(t.projectId)?.machineName || '',
          name: t.name,
          assignedName: lookups.userName(t.assignedUserId) || lookups.roleById.get(t.roleId)?.name || '',
          plannedEnd: t.plannedEnd,
          daysLate: Math.round((Date.now() - new Date(t.plannedEnd).getTime()) / (24 * 3600 * 1000)),
          status: t.status
        });
      }
      for (const p of projects.filter((p) => p.plannedEndDate && !['completed', 'cancelled'].includes(p.status) && new Date(p.plannedEndDate).getTime() < Date.now())) {
        rows.push({
          kind: 'Project',
          projectCode: p.code,
          machineName: p.machineName,
          name: p.code,
          assignedName: lookups.userName(p.responsibleUserId) || '',
          plannedEnd: p.plannedEndDate,
          daysLate: Math.round((Date.now() - new Date(p.plannedEndDate).getTime()) / (24 * 3600 * 1000)),
          status: p.status
        });
      }
      return rows.sort((a, b) => b.daysLate - a.daysLate);
    }
  },
  'planned-vs-actual': {
    title: 'Planned vs actual duration',
    columns: [
      { key: 'projectCode', label: 'Project' },
      { key: 'machineName', label: 'Machine' },
      { key: 'name', label: 'Task' },
      { key: 'plannedDays', label: 'Planned (days)' },
      { key: 'actualDays', label: 'Actual (days)' },
      { key: 'delta', label: 'Difference (days)' }
    ],
    build({ projects, tasks }) {
      const projectById = new Map(projects.map((p) => [p.id, p]));
      return tasks
        .filter((t) => t.actualStart && t.actualEnd)
        .map((t) => {
          const planned = Math.round(durationToDays(t.estimatedDuration, t.durationUnit) * 10) / 10;
          const actual = Math.round(((new Date(t.actualEnd) - new Date(t.actualStart)) / (24 * 3600 * 1000)) * 10) / 10;
          return {
            projectCode: projectById.get(t.projectId)?.code || '',
            machineName: projectById.get(t.projectId)?.machineName || '',
            name: t.name,
            plannedDays: planned,
            actualDays: actual,
            delta: Math.round((actual - planned) * 10) / 10
          };
        });
    }
  },
  'completed-machines': {
    title: 'Completed machines',
    columns: [
      { key: 'machineName', label: 'Machine' },
      { key: 'machineReference', label: 'Reference' },
      { key: 'code', label: 'Project' },
      { key: 'typeName', label: 'Type' },
      { key: 'actualEndDate', label: 'Completed on', value: (r) => fmtDate(r.actualEndDate) },
      { key: 'durationDays', label: 'Duration (days)' }
    ],
    build({ projects, lookups }) {
      return projects
        .filter((p) => p.status === 'completed')
        .map((p) => ({
          machineName: p.machineName,
          machineReference: p.machineReference || '',
          code: p.code,
          typeName: lookups.projectTypeById.get(p.projectTypeId)?.name || '',
          actualEndDate: p.actualEndDate,
          durationDays: p.actualEndDate && p.startDate ? Math.round((new Date(p.actualEndDate) - new Date(p.startDate)) / (24 * 3600 * 1000)) : ''
        }))
        .sort((a, b) => String(b.actualEndDate).localeCompare(String(a.actualEndDate)));
    }
  },
  'machine-history': {
    title: 'Machine project history',
    columns: [
      { key: 'machineName', label: 'Machine' },
      { key: 'machineReference', label: 'Reference' },
      { key: 'machineSerial', label: 'Serial' },
      { key: 'projectsCount', label: 'Projects' },
      { key: 'history', label: 'History' }
    ],
    build({ projects, lookups }) {
      const groups = new Map();
      for (const p of projects) {
        const key = String(p.machineReference || p.machineName).toLowerCase();
        if (!groups.has(key)) {
          groups.set(key, { machineName: p.machineName, machineReference: p.machineReference || '', machineSerial: p.machineSerial || '', rows: [] });
        }
        const typeName = lookups.projectTypeById.get(p.projectTypeId)?.name || '';
        const year = p.actualEndDate ? new Date(p.actualEndDate).getFullYear() : (p.startDate ? new Date(p.startDate).getFullYear() : '');
        groups.get(key).rows.push(`${p.code}: ${typeName} - ${p.status}${year ? ` (${year})` : ''}`);
      }
      return [...groups.values()].map((g) => ({ ...g, projectsCount: g.rows.length, history: g.rows.join(' | ') }));
    }
  },
  'approval-history': {
    title: 'Approval history',
    columns: [
      { key: 'submittedAt', label: 'Submitted at', value: (r) => fmtDate(r.submittedAt) },
      { key: 'machineName', label: 'Machine' },
      { key: 'taskName', label: 'Task' },
      { key: 'stepTitle', label: 'Step' },
      { key: 'submittedByName', label: 'Submitted by' },
      { key: 'status', label: 'Decision' },
      { key: 'reviewedByName', label: 'Reviewed by' },
      { key: 'reviewedAt', label: 'Reviewed at', value: (r) => fmtDate(r.reviewedAt) },
      { key: 'hours', label: 'Hours to review' },
      { key: 'reason', label: 'Reason' }
    ],
    build({ approvals, projects, tasks, lookups }) {
      const projectById = new Map(projects.map((p) => [p.id, p]));
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      return approvals
        .map((a) => ({
          submittedAt: a.submittedAt,
          machineName: projectById.get(a.projectId)?.machineName || '',
          taskName: a.taskName || taskById.get(a.taskId)?.name || '',
          stepTitle: a.stepTitle || '',
          submittedByName: lookups.userName(a.submittedBy) || '',
          status: a.status,
          reviewedByName: lookups.userName(a.reviewedBy) || '',
          reviewedAt: a.reviewedAt,
          hours: a.reviewedAt && a.submittedAt ? Math.round(((new Date(a.reviewedAt) - new Date(a.submittedAt)) / 3600000) * 10) / 10 : '',
          reason: a.reason || ''
        }))
        .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    }
  }
};

insightsRouter.get('/reports', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  res.json(Object.entries(REPORT_BUILDERS).map(([key, builder]) => ({
    key,
    title: builder.title,
    columns: builder.columns.map((c) => ({ key: c.key, label: c.label }))
  })));
}));

insightsRouter.get('/reports/:name', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const builder = REPORT_BUILDERS[req.params.name];
  if (!builder) return res.status(404).json({ error: { message: `Unknown report "${req.params.name}"` } });
  const world = await loadWorld();
  const rows = builder.build(world);
  if (str(req.query.format).toLowerCase() === 'csv') {
    const csv = toCsv(rows, builder.columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
    return res.send(csv);
  }
  return res.json({
    title: builder.title,
    columns: builder.columns.map((c) => ({ key: c.key, label: c.label })),
    rows
  });
}));

// ------------------------------------------------------------ GLOBAL SEARCH

insightsRouter.get('/search', asyncHandler(async (req, res) => {
  const term = str(req.query.q).toLowerCase();
  if (!term || term.length < 2) return res.json({ projects: [], tasks: [], machines: [], people: [] });

  const [projects, tasks, lookups] = await Promise.all([
    collections.projects.all(), collections.tasks.all(), buildLookups()
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const projectRows = projects
    .filter((p) => [p.machineName, p.machineReference, p.machineSerial, p.code, p.description].some((v) => String(v || '').toLowerCase().includes(term)))
    .slice(0, 8)
    .map((p) => ({
      id: p.id, code: p.code, machineName: p.machineName, status: p.status,
      typeName: lookups.projectTypeById.get(p.projectTypeId)?.name || null
    }));

  const taskRows = tasks
    .filter((t) => {
      const project = projectById.get(t.projectId);
      return [t.name, t.description, project?.machineName, project?.code].some((v) => String(v || '').toLowerCase().includes(term));
    })
    .slice(0, 8)
    .map((t) => ({
      id: t.id, name: t.name, status: t.status,
      machineName: projectById.get(t.projectId)?.machineName || '', projectId: t.projectId
    }));

  const machineKeys = new Map();
  for (const p of projects) {
    const key = String(p.machineReference || p.machineName).toLowerCase();
    if (!machineKeys.has(key)) machineKeys.set(key, { machineName: p.machineName, machineReference: p.machineReference || '', projects: 0 });
    machineKeys.get(key).projects += 1;
  }
  const machineRows = [...machineKeys.values()]
    .filter((m) => m.machineName.toLowerCase().includes(term) || m.machineReference.toLowerCase().includes(term))
    .slice(0, 8);

  const canSeeUsers = (req.permissions || []).includes('*') || (req.permissions || []).includes('users.view');
  const peopleRows = canSeeUsers
    ? lookups.users
      .filter((u) => [u.firstName, u.lastName, u.username, u.email].some((v) => String(v || '').toLowerCase().includes(term)))
      .slice(0, 8)
      .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || u.username, username: u.username, active: u.active !== false }))
    : [];

  res.json({ projects: projectRows, tasks: taskRows, machines: machineRows, people: peopleRows });
}));

// ------------------------------------------------------------ AUDIT LOGS

insightsRouter.get('/audit-logs', requirePermission('audit_logs.view'), asyncHandler(async (req, res) => {
  const { entityType, userId, action, q, from, to } = req.query;
  let rows = await collections.auditLogs.all();
  if (entityType) rows = rows.filter((r) => r.entityType === str(entityType));
  if (userId) rows = rows.filter((r) => r.userId === str(userId));
  if (action) rows = rows.filter((r) => r.action === str(action));
  const term = str(q).toLowerCase();
  if (term) rows = rows.filter((r) => [r.entityLabel, r.userName, r.details].some((v) => String(v || '').toLowerCase().includes(term)));
  if (from) rows = rows.filter((r) => new Date(r.at).getTime() >= new Date(from).getTime());
  if (to) rows = rows.filter((r) => new Date(r.at).getTime() <= new Date(to).getTime());
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(rows.slice(0, limit));
}));

export { REPORT_BUILDERS };
