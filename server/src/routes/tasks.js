// Task + step execution endpoints (spec sections 7-15, 33-35) and the approval API.
import { Router } from 'express';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers } from '../core/notify.js';
import { upload } from '../middleware/upload.js';
import { deleteBlob } from '../storage/blobStore.js';
import { buildLookups } from '../services/lookups.js';
import { taskComputed, isTaskDone, computeTaskProgress } from '../services/projectService.js';
import {
  startTask, startStep, completeStep, completeTask, reviewApproval, addEvidence, deleteEvidence
} from '../services/taskService.js';
import {
  TASK_STATUSES, STEP_STATUSES, PRIORITIES, PROJECT_STATUSES, DURATION_UNITS
} from '../constants.js';
import {
  newId, nowIso, asyncHandler, badRequest, notFound, conflict,
  str, strOrNull, toNum, toBool, idArray
} from '../utils.js';
import { serializeAttachment } from './projects.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

// ------------------------------------------------------------ helpers

function normReq(rows, idKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ [idKey]: str(r[idKey]), quantity: toNum(r.quantity, 1), unit: str(r.unit), notes: str(r.notes) }))
    .filter((r) => r[idKey]);
}

function mergeSteps(existingSteps, incomingSteps) {
  const byId = new Map((existingSteps || []).map((s) => [s.id, s]));
  return (Array.isArray(incomingSteps) ? incomingSteps : []).map((s, index) => {
    const old = s.id ? byId.get(str(s.id)) : null;
    return {
      id: old?.id || newId('step'),
      order: index + 1,
      // Keep the template link so instruction files stay attached after task edits.
      sourceTemplateStepId: str(s.sourceTemplateStepId) || old?.sourceTemplateStepId || null,
      title: str(s.title) || old?.title || `Step ${index + 1}`,
      description: str(s.description),
      instructions: str(s.instructions),
      estimatedDuration: toNum(s.estimatedDuration, 0),
      durationUnit: s.durationUnit || 'days',
      roleId: strOrNull(s.roleId),
      assignedUserId: strOrNull(s.assignedUserId),
      components: normReq(s.components, 'componentId'),
      tools: normReq(s.tools, 'toolId'),
      evidenceRequired: s.evidenceRequired !== false,
      evidenceTypes: idArray(s.evidenceTypes),
      minFiles: toNum(s.minFiles, 1),
      maxFiles: toNum(s.maxFiles, null),
      measurement: {
        enabled: !!s.measurement?.enabled,
        name: str(s.measurement?.name),
        expected: toNum(s.measurement?.expected, null),
        tolerance: Math.abs(toNum(s.measurement?.tolerance, 0)) || 0,
        unit: str(s.measurement?.unit),
        required: s.measurement?.required !== false
      },
      approvalRequired: !!s.approvalRequired,
      status: old?.status || 'not_started',
      startedAt: old?.startedAt || null,
      completedAt: old?.completedAt || null,
      completedBy: old?.completedBy || null,
      submittedAt: old?.submittedAt || null,
      submittedBy: old?.submittedBy || null,
      rejectionReason: old?.rejectionReason || null,
      completionNote: old?.completionNote || '',
      notes: str(s.notes)
    };
  });
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

function enrichApproval(approval, lookups, projectById, taskByIdForSteps) {
  const project = projectById.get(approval.projectId);
  return {
    ...approval,
    submittedByName: lookups.userName(approval.submittedBy),
    reviewedByName: lookups.userName(approval.reviewedBy),
    machineName: project?.machineName || null,
    projectCode: project?.code || null,
    stepTitle: approval.stepTitle || taskByIdForSteps?.(approval) || null
  };
}

// ------------------------------------------------------------ LIST

tasksRouter.get('/tasks', requirePermission('tasks.view'), asyncHandler(async (req, res) => {
  const { q, projectId, assignedUserId, roleId, status, mine, overdue, waitingApproval, dueToday } = req.query;
  const [tasks, projects, lookups] = await Promise.all([
    collections.tasks.all(), collections.projects.all(), buildLookups()
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const perms = req.permissions || [];
  const isManager = perms.includes('*') || perms.includes('tasks.edit') || perms.includes('tasks.override');

  let rows = tasks;
  if (mine === '1') {
    rows = rows.filter((t) => t.assignedUserId === req.user.id || (t.steps || []).some((s) => s.assignedUserId === req.user.id));
  }
  if (!isManager && !perms.includes('*') && !req.query.all) {
    // Non-managers only see their own tasks + tasks of their role (so they can pick up work)
    rows = rows.filter((t) =>
      t.assignedUserId === req.user.id ||
      (t.steps || []).some((s) => s.assignedUserId === req.user.id) ||
      (req.userRoles || []).some((r) => r.id === t.roleId)
    );
  }
  if (projectId) rows = rows.filter((t) => t.projectId === str(projectId));
  if (assignedUserId) rows = rows.filter((t) => t.assignedUserId === str(assignedUserId));
  if (roleId) rows = rows.filter((t) => t.roleId === str(roleId));
  if (status) rows = rows.filter((t) => t.status === str(status));
  if (waitingApproval === '1') rows = rows.filter((t) => t.status === 'submitted');
  if (dueToday === '1') {
    const today = new Date().toISOString().slice(0, 10);
    rows = rows.filter((t) => !isTaskDone(t) && t.plannedEnd && String(t.plannedEnd).slice(0, 10) === today);
  }
  if (overdue === '1') {
    const now = Date.now();
    rows = rows.filter((t) => !isTaskDone(t) && t.plannedEnd && new Date(t.plannedEnd).getTime() < now);
  }
  const term = str(q).toLowerCase();
  if (term) {
    rows = rows.filter((t) => {
      const project = projectById.get(t.projectId);
      return [t.name, t.description, project?.machineName, project?.code, project?.machineReference]
        .some((v) => String(v || '').toLowerCase().includes(term));
    });
  }

  const enriched = rows
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((t) => {
      const project = projectById.get(t.projectId);
      return {
        ...enrichTask(t, lookups, taskById),
        projectCode: project?.code || null,
        machineName: project?.machineName || null,
        machineReference: project?.machineReference || null,
        projectStatus: project?.status || null
      };
    });
  res.json(enriched);
}));

// ------------------------------------------------------------ DETAIL

tasksRouter.get('/tasks/:id', requirePermission('tasks.view'), asyncHandler(async (req, res) => {
  const task = await collections.tasks.getById(req.params.id);
  if (!task) throw notFound('Task not found');

  const [project, lookups, taskList, evidenceRows, approvalRows, commentRows, attachmentRows, projectAttachments] = await Promise.all([
    collections.projects.getById(task.projectId),
    buildLookups(),
    collections.tasks.find({ projectId: task.projectId }),
    collections.evidence.find({ taskId: task.id }),
    collections.approvals.find({ taskId: task.id }),
    collections.comments.find({ taskId: task.id }),
    collections.attachments.find((a) => a.taskId === task.id),
    task.projectId ? collections.attachments.find({ ownerType: 'project', ownerId: task.projectId }) : Promise.resolve([])
  ]);

  const taskById = new Map(taskList.map((t) => [t.id, t]));
  const projectById = new Map([[task.projectId, project]]);
  const attachmentById = new Map(attachmentRows.map((a) => [a.id, a]));
  const projectType = project ? lookups.projectTypeById.get(project.projectTypeId) : null;

  // Instruction files (hints) attached to the workflow template steps this task was created from.
  // They are resolved live, so updated work instructions reach running projects too.
  const hintRows = [];
  {
    const templateToProjectStep = new Map(); // template step id -> project step id
    for (const step of task.steps || []) {
      if (step.sourceTemplateStepId) templateToProjectStep.set(step.sourceTemplateStepId, step.id);
    }
    // Older projects have no stored step link: match the template by task/step order + title.
    const linked = new Set(templateToProjectStep.values());
    const unlinked = (task.steps || []).filter((s) => !linked.has(s.id));
    if (unlinked.length > 0 && project?.templateId) {
      const template = await collections.workflowTemplates.getById(project.templateId);
      const tplTask = (template?.tasks || []).find((t) => (t.order || 0) === (task.order || 0));
      for (const step of unlinked) {
        const tplStep = (tplTask?.steps || []).find((s) => (s.order || 0) === (step.order || 0));
        if (tplStep && str(tplStep.title) === str(step.title)) templateToProjectStep.set(tplStep.id, step.id);
      }
    }
    const sourceIds = [...templateToProjectStep.keys()];
    if (sourceIds.length > 0) {
      const rows = await collections.attachments.find((a) => a.ownerType === 'template_step' && sourceIds.includes(a.ownerId));
      for (const row of rows) hintRows.push({ ...row, stepId: templateToProjectStep.get(row.ownerId) });
    }
  }

  const perms = req.permissions || [];
  const canReview = perms.includes('*') || perms.includes('approvals.approve');
  const canWork =
    (perms.includes('*') || perms.includes('steps.complete') || perms.includes('tasks.complete')) &&
    (!task.assignedUserId || task.assignedUserId === req.user.id || perms.includes('tasks.edit') || perms.includes('tasks.override'));

  res.json({
    task: enrichTask(task, lookups, taskById),
    project: project ? {
      id: project.id,
      code: project.code,
      machineName: project.machineName,
      machineReference: project.machineReference,
      machineSerial: project.machineSerial,
      status: project.status,
      priority: project.priority,
      progress: project.progress || 0,
      typeName: projectType?.name || null,
      responsibleName: lookups.userName(project.responsibleUserId),
      startDate: project.startDate,
      plannedEndDate: project.plannedEndDate
    } : null,
    evidence: evidenceRows.map((e) => {
      const attachment = e.attachmentId ? attachmentById.get(e.attachmentId) : null;
      return {
        ...e,
        createdByName: lookups.userName(e.createdBy),
        attachment: attachment ? { ...serializeAttachment(attachment), uploadedByName: lookups.userName(attachment.uploadedBy) } : null
      };
    }),
    approvals: approvalRows
      .map((a) => enrichApproval(a, lookups, projectById, () => null))
      .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))),
    comments: commentRows
      .map((c) => ({ ...c, userName: lookups.userName(c.userId) }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    attachments: [...attachmentRows, ...projectAttachments]
      .map((a) => ({ ...serializeAttachment(a), uploadedByName: lookups.userName(a.uploadedBy) })),
    hints: hintRows
      .sort((a, b) => String(a.uploadedAt || a.createdAt).localeCompare(String(b.uploadedAt || b.createdAt)))
      .map((a) => ({ ...serializeAttachment(a), uploadedByName: lookups.userName(a.uploadedBy) })),
    refs: {
      users: lookups.users.filter((u) => u.active !== false).map((u) => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username,
        roleIds: u.roleIds || []
      })),
      roles: lookups.roles.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      materials: lookups.materials,
      components: lookups.components,
      tools: lookups.tools,
      evidenceTypes: lookups.evidenceTypes,
      statuses: { task: TASK_STATUSES, step: STEP_STATUSES, project: PROJECT_STATUSES },
      priorities: PRIORITIES,
      durationUnits: DURATION_UNITS
    },
    permissions: { canWork, canReview, canEdit: perms.includes('*') || perms.includes('tasks.edit') }
  });
}));

// ------------------------------------------------------------ UPDATE (admin / engineer)

tasksRouter.put('/tasks/:id', requirePermission('tasks.edit'), asyncHandler(async (req, res) => {
  const task = await collections.tasks.getById(req.params.id);
  if (!task) throw notFound('Task not found');
  const body = req.body || {};
  const projectTasks = await collections.tasks.find({ projectId: task.projectId });
  const validDeps = new Set(projectTasks.map((t) => t.id));

  const patch = {};
  if (body.name !== undefined) {
    if (!str(body.name)) throw badRequest('Task name cannot be empty');
    patch.name = str(body.name);
  }
  if (body.description !== undefined) patch.description = str(body.description);
  if (body.roleId !== undefined) patch.roleId = strOrNull(body.roleId);
  if (body.assignedUserId !== undefined) patch.assignedUserId = strOrNull(body.assignedUserId);
  if (body.estimatedDuration !== undefined) patch.estimatedDuration = toNum(body.estimatedDuration, 0);
  if (body.durationUnit !== undefined) patch.durationUnit = str(body.durationUnit) || 'days';
  if (body.priority !== undefined) patch.priority = str(body.priority);
  if (body.approvalRequired !== undefined) patch.approvalRequired = !!body.approvalRequired;
  if (body.sequentialSteps !== undefined) patch.sequentialSteps = !!body.sequentialSteps;
  if (body.notes !== undefined) patch.notes = str(body.notes);
  if (body.order !== undefined) patch.order = toNum(body.order, task.order);
  if (body.plannedStart !== undefined) patch.plannedStart = body.plannedStart ? new Date(body.plannedStart).toISOString() : null;
  if (body.plannedEnd !== undefined) patch.plannedEnd = body.plannedEnd ? new Date(body.plannedEnd).toISOString() : null;
  if (body.dependsOn !== undefined) {
    patch.dependsOn = idArray(body.dependsOn).filter((id) => validDeps.has(id) && id !== task.id);
  }
  if (body.components !== undefined) patch.components = normReq(body.components, 'componentId');
  if (body.tools !== undefined) patch.tools = normReq(body.tools, 'toolId');
  if (body.progress !== undefined && (task.steps || []).length === 0) {
    patch.progress = Math.min(100, Math.max(0, toNum(body.progress, 0)));
  }

  let removedStepIds = [];
  if (body.steps !== undefined) {
    const merged = mergeSteps(task.steps, body.steps);
    removedStepIds = (task.steps || []).map((s) => s.id).filter((id) => !merged.some((s) => s.id === id));
    patch.steps = merged;
  }

  const result = await collections.tasks.transaction((rows) => {
    const doc = rows.find((t) => t.id === task.id);
    if (!doc) throw notFound('Task not found');
    const before = structuredClone(doc);
    Object.assign(doc, patch);
    doc.progress = computeTaskProgress(doc);
    doc.updatedAt = nowIso();
    return { before, after: structuredClone(doc) };
  });

  // Cleanup evidence + files of removed steps
  for (const stepId of removedStepIds) {
    const evidenceRows = await collections.evidence.find({ stepId });
    for (const evidence of evidenceRows) {
      if (evidence.attachmentId) {
        const attachment = await collections.attachments.getById(evidence.attachmentId);
        if (attachment) {
          await deleteBlob(attachment.storedRel);
          await collections.attachments.remove(attachment.id);
        }
      }
    }
    await collections.evidence.removeWhere({ stepId });
  }

  await logAudit({
    user: req.user, action: 'update', entityType: 'task', entityId: task.id,
    entityLabel: result.after.name, details: 'Task updated',
    changes: {
      before: { name: result.before.name, assignedUserId: result.before.assignedUserId, status: result.before.status, plannedEnd: result.before.plannedEnd },
      after: { name: result.after.name, assignedUserId: result.after.assignedUserId, status: result.after.status, plannedEnd: result.after.plannedEnd }
    }
  });

  if (patch.assignedUserId && patch.assignedUserId !== task.assignedUserId) {
    const project = await collections.projects.getById(task.projectId);
    await notifyUsers([patch.assignedUserId], {
      type: 'task_assigned',
      title: 'Task assigned to you',
      message: `${project?.machineName || ''}: task "${result.after.name}" was assigned to you.`,
      link: `/tasks/${task.id}`,
      entityType: 'task',
      entityId: task.id
    }, { excludeUserId: req.user.id });
  }

  const lookups = await buildLookups();
  const taskById = new Map(projectTasks.map((t) => [t.id, t]));
  taskById.set(result.after.id, result.after);
  res.json(enrichTask(result.after, lookups, taskById));
}));

// ------------------------------------------------------------ ACTIONS

tasksRouter.post('/tasks/:id/start', requirePermission('tasks.complete'), asyncHandler(async (req, res) => {
  const task = await startTask({ taskId: req.params.id, user: req.user, permissions: req.permissions });
  const lookups = await buildLookups();
  const taskById = new Map((await collections.tasks.find({ projectId: task.projectId })).map((t) => [t.id, t]));
  res.json(enrichTask(task, lookups, taskById));
}));

tasksRouter.post('/tasks/:id/status', requirePermission('tasks.edit'), asyncHandler(async (req, res) => {
  const task = await collections.tasks.getById(req.params.id);
  if (!task) throw notFound('Task not found');
  const status = str(req.body?.status);
  if (!['waiting', 'blocked', 'in_progress'].includes(status)) {
    throw badRequest('Manual status can only be: waiting, blocked, in_progress');
  }
  const result = await collections.tasks.update(task.id, { status });
  await logAudit({ user: req.user, action: 'status', entityType: 'task', entityId: task.id, entityLabel: task.name, details: `Status set to ${status}${req.body?.note ? `: ${str(req.body.note)}` : ''}` });
  res.json(result.after);
}));

tasksRouter.post('/tasks/:id/complete', requirePermission('tasks.complete'), asyncHandler(async (req, res) => {
  const task = await completeTask({
    taskId: req.params.id, user: req.user, permissions: req.permissions,
    note: str(req.body?.note), force: toBool(req.body?.force)
  });
  const lookups = await buildLookups();
  const taskById = new Map((await collections.tasks.find({ projectId: task.projectId })).map((t) => [t.id, t]));
  res.json(enrichTask(task, lookups, taskById));
}));

tasksRouter.post('/tasks/:id/steps/:stepId/start', requirePermission('steps.complete'), asyncHandler(async (req, res) => {
  const task = await startStep({ taskId: req.params.id, stepId: req.params.stepId, user: req.user, permissions: req.permissions });
  const lookups = await buildLookups();
  const taskById = new Map((await collections.tasks.find({ projectId: task.projectId })).map((t) => [t.id, t]));
  res.json(enrichTask(task, lookups, taskById));
}));

tasksRouter.post('/tasks/:id/steps/:stepId/complete', requirePermission('steps.complete'), asyncHandler(async (req, res) => {
  const task = await completeStep({
    taskId: req.params.id, stepId: req.params.stepId, user: req.user, permissions: req.permissions,
    note: str(req.body?.note), force: toBool(req.body?.force)
  });
  const lookups = await buildLookups();
  const taskById = new Map((await collections.tasks.find({ projectId: task.projectId })).map((t) => [t.id, t]));
  res.json(enrichTask(task, lookups, taskById));
}));

// ------------------------------------------------------------ EVIDENCE

tasksRouter.post('/tasks/:id/steps/:stepId/evidence', requirePermission('attachments.upload'), upload.single('file'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  let measurement = null;
  let checklist = null;
  try {
    if (body.measurement) measurement = JSON.parse(body.measurement);
    if (body.checklist) checklist = JSON.parse(body.checklist);
  } catch {
    throw badRequest('Invalid measurement/checklist payload');
  }
  const evidence = await addEvidence({
    taskId: req.params.id,
    stepId: req.params.stepId,
    user: req.user,
    permissions: req.permissions,
    type: str(body.type),
    file: req.file || null,
    measurement,
    checklist,
    comment: str(body.comment),
    description: str(body.description)
  });
  res.status(201).json(evidence);
}));

tasksRouter.delete('/evidence/:id', requireAuth, asyncHandler(async (req, res) => {
  await deleteEvidence({ evidenceId: req.params.id, user: req.user, permissions: req.permissions });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ APPROVALS

tasksRouter.get('/approvals', requireAuth, asyncHandler(async (req, res) => {
  const perms = req.permissions || [];
  const canReview = perms.includes('*') || perms.includes('approvals.approve');
  const [approvals, lookups, projects] = await Promise.all([
    collections.approvals.all(), buildLookups(), collections.projects.all()
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const relatedTasks = await collections.tasks.all();
  const taskById = new Map(relatedTasks.map((t) => [t.id, t]));

  let rows = approvals.filter((a) => canReview || a.submittedBy === req.user.id);
  if (req.query.status) rows = rows.filter((a) => a.status === str(req.query.status));
  if (req.query.scope) rows = rows.filter((a) => a.scope === str(req.query.scope));
  if (req.query.mine === '1') rows = rows.filter((a) => a.submittedBy === req.user.id);

  rows = rows
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .map((a) => enrichApproval(a, lookups, projectById, () => null));
  res.json(rows.map((a) => ({ ...a, canReview })));
}));

tasksRouter.post('/approvals/:id/approve', requirePermission('approvals.approve'), asyncHandler(async (req, res) => {
  const result = await reviewApproval({
    approvalId: req.params.id, decision: 'approved', reason: str(req.body?.reason), user: req.user
  });
  res.json(result);
}));

tasksRouter.post('/approvals/:id/reject', requirePermission('approvals.approve'), asyncHandler(async (req, res) => {
  const reason = str(req.body?.reason);
  if (!reason) throw badRequest('A rejection reason is required');
  const result = await reviewApproval({
    approvalId: req.params.id, decision: 'rejected', reason, user: req.user
  });
  res.json(result);
}));

export { enrichTask, enrichApproval };
