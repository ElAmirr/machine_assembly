// Machine Project module (spec sections 4, 5, 22, 23, 39).
import { Router } from 'express';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers } from '../core/notify.js';
import { buildLookups } from '../services/lookups.js';
import {
  createProject, enrichProject, taskComputed, deleteProjectCascade, machineHistory, isTaskDone
} from '../services/projectService.js';
import {
  newId, nowIso, addDuration, asyncHandler, badRequest, notFound, conflict,
  str, strOrNull, toNum, idArray, pick
} from '../utils.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

function toIsoOrNull(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date for ${fieldName}`);
  return d.toISOString();
}

function enrichTask(task, lookups, taskById) {
  return {
    ...task,
    roleName: lookups.roleById.get(task.roleId)?.name || null,
    assignedName: lookups.userName(task.assignedUserId),
    computed: taskComputed(task, taskById),
    stepsDone: (task.steps || []).filter((s) => s.status === 'completed').length,
    stepsTotal: (task.steps || []).length
  };
}

/** Technicians only see projects that contain their work (spec section 3). */
async function visibleProjectIds(req, tasks) {
  const perms = req.permissions || [];
  if (perms.includes('*') || perms.includes('tasks.edit') || perms.includes('projects.create')) return null; // null = all
  const projects = await collections.projects.all();
  const ids = new Set();
  for (const project of projects) {
    if (project.responsibleUserId === req.user.id || project.createdBy === req.user.id) ids.add(project.id);
  }
  for (const task of tasks) {
    if (task.assignedUserId === req.user.id) ids.add(task.projectId);
    if ((task.steps || []).some((s) => s.assignedUserId === req.user.id)) ids.add(task.projectId);
  }
  return ids;
}

// ------------------------------------------------------------------ LIST

projectsRouter.get('/projects', requirePermission('projects.view'), asyncHandler(async (req, res) => {
  const { q, status, priority, departmentId, locationId, responsibleUserId, mine, delayed, projectTypeId } = req.query;
  const [projects, tasks, lookups] = await Promise.all([
    collections.projects.all(), collections.tasks.all(), buildLookups()
  ]);

  const allowed = await visibleProjectIds(req, tasks);
  const tasksByProject = new Map();
  for (const task of tasks) {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, []);
    tasksByProject.get(task.projectId).push(task);
  }

  const term = str(q).toLowerCase();
  let rows = projects.map((project) => enrichProject(project, lookups, tasksByProject.get(project.id) || []));

  if (allowed) rows = rows.filter((p) => allowed.has(p.id));
  if (projectTypeId) rows = rows.filter((p) => p.projectTypeId === str(projectTypeId));
  if (status) rows = rows.filter((p) => p.status === str(status));
  if (priority) rows = rows.filter((p) => p.priority === str(priority));
  if (departmentId) rows = rows.filter((p) => p.departmentId === str(departmentId));
  if (locationId) rows = rows.filter((p) => p.locationId === str(locationId));
  if (responsibleUserId) rows = rows.filter((p) => p.responsibleUserId === str(responsibleUserId));
  if (mine === '1') rows = rows.filter((p) => p.responsibleUserId === req.user.id || p.createdBy === req.user.id);
  if (delayed === '1') rows = rows.filter((p) => p.overdue || p.status === 'blocked');
  if (term) {
    rows = rows.filter((p) =>
      [p.machineName, p.machineReference, p.machineSerial, p.code, p.description, p.productionLine]
        .some((v) => String(v || '').toLowerCase().includes(term))
    );
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json(rows);
}));

// ------------------------------------------------------------------ MACHINES (history overview)

projectsRouter.get('/machines', requirePermission('projects.view'), asyncHandler(async (req, res) => {
  const [projects, projectTypes] = await Promise.all([collections.projects.all(), collections.projectTypes.all()]);
  const typeById = new Map(projectTypes.map((t) => [t.id, t]));
  const groups = new Map();
  for (const project of projects) {
    const key = String(project.machineReference || project.machineName || '').toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        machineName: project.machineName,
        machineReference: project.machineReference || '',
        machineSerial: project.machineSerial || '',
        projects: []
      });
    }
    groups.get(key).projects.push({
      id: project.id,
      code: project.code,
      status: project.status,
      typeName: typeById.get(project.projectTypeId)?.name || null,
      progress: project.progress || 0,
      startDate: project.startDate,
      plannedEndDate: project.plannedEndDate,
      actualEndDate: project.actualEndDate
    });
  }
  const rows = [...groups.values()].map((g) => ({
    ...g,
    projectsCount: g.projects.length,
    lastProject: g.projects.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0]
  }));
  rows.sort((a, b) => String(a.machineName).localeCompare(String(b.machineName)));
  res.json(rows);
}));

// ------------------------------------------------------------------ CREATE

projectsRouter.post('/projects', requirePermission('projects.create'), asyncHandler(async (req, res) => {
  const { project } = await createProject(req.body || {}, req.user);
  const lookups = await buildLookups();
  const tasks = await collections.tasks.find({ projectId: project.id });
  res.status(201).json(enrichProject(project, lookups, tasks));
}));

// ------------------------------------------------------------------ DETAIL

projectsRouter.get('/projects/:id', requirePermission('projects.view'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const [tasks, lookups, attachments] = await Promise.all([
    collections.tasks.find({ projectId: project.id }),
    buildLookups(),
    collections.attachments.find({ projectId: project.id })
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const sortedTasks = tasks
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((t) => enrichTask(t, lookups, taskById));
  const detail = enrichProject(project, lookups, tasks);
  res.json({
    ...detail,
    tasks: sortedTasks,
    attachments: attachments.map(serializeAttachment),
    createdByName: lookups.userName(project.createdBy),
    templateName: project.templateName || null
  });
}));

projectsRouter.get('/projects/:id/history', requirePermission('projects.view'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const [history, lookups, tasks] = await Promise.all([
    machineHistory(project), buildLookups(), collections.tasks.all()
  ]);
  const rows = history.map((p) => {
    const projectTasks = tasks.filter((t) => t.projectId === p.id);
    return enrichProject(p, lookups, projectTasks);
  });
  res.json(rows);
}));

// ------------------------------------------------------------------ UPDATE

const EDITABLE_PROJECT_FIELDS = [
  'machineName', 'machineReference', 'machineSerial', 'description', 'productionLine',
  'departmentId', 'locationId', 'responsibleUserId', 'status', 'priority'
];

projectsRouter.put('/projects/:id', requirePermission('projects.edit'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const body = req.body || {};

  const patch = pick(body, EDITABLE_PROJECT_FIELDS);
  for (const field of ['machineName', 'machineReference', 'machineSerial', 'description', 'productionLine']) {
    if (patch[field] !== undefined) patch[field] = str(patch[field]);
  }
  for (const field of ['departmentId', 'locationId', 'responsibleUserId']) {
    if (patch[field] !== undefined) patch[field] = strOrNull(patch[field]);
  }
  if (patch.machineName !== undefined && !patch.machineName) throw badRequest('Machine name cannot be empty');
  if (body.projectTypeId !== undefined) {
    const type = await collections.projectTypes.getById(str(body.projectTypeId));
    if (!type) throw badRequest('Selected project type does not exist');
    patch.projectTypeId = str(body.projectTypeId);
  }
  for (const field of ['startDate', 'plannedEndDate', 'actualEndDate']) {
    const value = toIsoOrNull(body[field], field);
    if (value !== undefined) patch[field] = value;
  }

  const result = await collections.projects.update(project.id, patch);
  await logAudit({
    user: req.user, action: 'update', entityType: 'project', entityId: project.id,
    entityLabel: `${result.after.code} ${result.after.machineName}`, details: 'Project updated', changes: result
  });

  if (patch.responsibleUserId && patch.responsibleUserId !== project.responsibleUserId) {
    await notifyUsers([patch.responsibleUserId], {
      type: 'project_assigned',
      title: 'You are responsible for a project',
      message: `${result.after.machineName} (${result.after.code}) - you were set as responsible person.`,
      link: `/projects/${project.id}`,
      entityType: 'project',
      entityId: project.id
    }, { excludeUserId: req.user.id });
  }

  const [tasks, lookups] = await Promise.all([collections.tasks.find({ projectId: project.id }), buildLookups()]);
  res.json(enrichProject(result.after, lookups, tasks));
}));

projectsRouter.patch('/projects/:id/status', requirePermission('projects.edit'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const status = str(req.body?.status);
  if (!status) throw badRequest('Status is required');
  const patch = { status };
  if (status === 'completed' && !project.actualEndDate) patch.actualEndDate = nowIso();
  const result = await collections.projects.update(project.id, patch);
  await logAudit({ user: req.user, action: 'status', entityType: 'project', entityId: project.id, entityLabel: project.code, details: `Status changed to ${status}` });
  res.json(result.after);
}));

projectsRouter.delete('/projects/:id', requirePermission('projects.delete'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const tasks = await collections.tasks.find({ projectId: project.id });
  const started = tasks.some((t) => t.status !== 'not_started' && t.status !== 'ready');
  const force = req.query.force === '1';
  if (started && !force) {
    throw conflict('This project has started work. Confirm deletion with force=1 to delete it with all its tasks, evidence and files.');
  }
  const result = await deleteProjectCascade(project.id);
  await logAudit({
    user: req.user, action: 'delete', entityType: 'project', entityId: project.id,
    entityLabel: `${project.code} ${project.machineName}`,
    details: `Project deleted with ${result.tasks} task(s) and ${result.files} file(s)`
  });
  res.json({ ok: true, ...result });
}));

// ------------------------------------------------------------------ ADD TASK MANUALLY

projectsRouter.post('/projects/:id/tasks', requirePermission('tasks.create'), asyncHandler(async (req, res) => {
  const project = await collections.projects.getById(req.params.id);
  if (!project) throw notFound('Project not found');
  const body = req.body || {};
  const name = str(body.name);
  if (!name) throw badRequest('Task name is required');

  const tasks = (await collections.tasks.find({ projectId: project.id })).sort((a, b) => (a.order || 0) - (b.order || 0));
  const last = tasks[tasks.length - 1];
  const plannedStart = toIsoOrNull(body.plannedStart, 'plannedStart') || (last?.plannedEnd) || project.startDate || nowIso();
  const duration = toNum(body.estimatedDuration, 0);
  const unit = body.durationUnit || 'days';
  const plannedEnd = toIsoOrNull(body.plannedEnd, 'plannedEnd') || addDuration(plannedStart, duration, unit);

  const task = await collections.tasks.insert({
    id: newId('task'),
    projectId: project.id,
    order: (last?.order || 0) + 1,
    name,
    description: str(body.description),
    roleId: strOrNull(body.roleId),
    assignedUserId: strOrNull(body.assignedUserId),
    estimatedDuration: duration,
    durationUnit: unit,
    plannedStart,
    plannedEnd,
    actualStart: null,
    actualEnd: null,
    status: (body.dependsOn || []).length ? 'not_started' : 'ready',
    priority: body.priority || project.priority || 'medium',
    dependsOn: idArray(body.dependsOn).filter((depId) => tasks.some((t) => t.id === depId)),
    approvalRequired: !!body.approvalRequired,
    pendingTaskApproval: false,
    sequentialSteps: body.sequentialSteps !== false,
    materials: [],
    components: [],
    tools: [],
    notes: '',
    progress: 0,
    steps: [],
    createdBy: req.user.id
  });

  await logAudit({ user: req.user, action: 'create', entityType: 'task', entityId: task.id, entityLabel: `${name} (project ${project.code})`, details: 'Task added to project' });
  if (task.assignedUserId) {
    await notifyUsers([task.assignedUserId], {
      type: 'task_assigned',
      title: 'New task assigned',
      message: `${project.machineName}: task "${name}" was assigned to you.`,
      link: `/tasks/${task.id}`,
      entityType: 'task',
      entityId: task.id
    }, { excludeUserId: req.user.id });
  }
  const lookups = await buildLookups();
  res.status(201).json(enrichTask(task, lookups, new Map(tasks.map((t) => [t.id, t]))));
}));

export function serializeAttachment(attachment) {
  if (!attachment) return null;
  const { storedRel, ...rest } = attachment;
  return rest;
}

export { enrichTask, visibleProjectIds };
