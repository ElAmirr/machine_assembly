// Workflow template module (spec section 6). Templates are reusable definitions;
// when a project is created they are COPIED (see projectService.createProject).
import { Router } from 'express';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { newId, nowIso, asyncHandler, badRequest, notFound, str, strOrNull, toNum, idArray } from '../utils.js';

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

function normReq(rows, idKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ [idKey]: str(r[idKey]), quantity: toNum(r.quantity, 1), unit: str(r.unit), notes: str(r.notes) }))
    .filter((r) => r[idKey]);
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, index) => ({
    id: str(s.id) || newId('wts'),
    order: index + 1,
    title: str(s.title) || `Step ${index + 1}`,
    description: str(s.description),
    instructions: str(s.instructions),
    estimatedDuration: toNum(s.estimatedDuration, 0),
    durationUnit: s.durationUnit || 'days',
    roleId: strOrNull(s.roleId),
    assignedUserId: strOrNull(s.assignedUserId),
    materials: normReq(s.materials, 'materialId'),
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
    notes: str(s.notes)
  }));
}

function normalizeTasks(tasks) {
  const withIds = (Array.isArray(tasks) ? tasks : []).map((t, index) => ({
    raw: t,
    id: str(t.id) || newId('wtt'),
    order: index + 1
  }));
  return withIds.map(({ raw, id, order }) => ({
    id,
    order,
    name: str(raw.name) || `Task ${order}`,
    description: str(raw.description),
    roleId: strOrNull(raw.roleId),
    assignedUserId: strOrNull(raw.assignedUserId),
    estimatedDuration: toNum(raw.estimatedDuration, 0),
    durationUnit: raw.durationUnit || 'days',
    approvalRequired: !!raw.approvalRequired,
    sequentialSteps: raw.sequentialSteps !== false,
    dependsOn: idArray(raw.dependsOn).filter((depId) => withIds.some((w) => w.id === depId && w.id !== id)),
    materials: normReq(raw.materials, 'materialId'),
    components: normReq(raw.components, 'componentId'),
    tools: normReq(raw.tools, 'toolId'),
    notes: str(raw.notes),
    steps: normalizeSteps(raw.steps)
  }));
}

async function validateProjectType(projectTypeId) {
  const type = await collections.projectTypes.getById(projectTypeId);
  if (!type) throw badRequest('Selected project type does not exist');
  return type;
}

workflowsRouter.get('/workflow-templates', requirePermission('workflow.view'), asyncHandler(async (req, res) => {
  const [templates, projectTypes] = await Promise.all([
    collections.workflowTemplates.all(), collections.projectTypes.all()
  ]);
  const typeById = new Map(projectTypes.map((t) => [t.id, t]));
  let rows = templates.map((t) => ({
    ...t,
    projectTypeName: typeById.get(t.projectTypeId)?.name || null,
    taskCount: (t.tasks || []).length,
    stepCount: (t.tasks || []).reduce((sum, task) => sum + (task.steps || []).length, 0)
  }));
  if (req.query.projectTypeId) rows = rows.filter((t) => t.projectTypeId === str(req.query.projectTypeId));
  if (req.query.active === '1') rows = rows.filter((t) => t.active !== false);
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(rows);
}));

workflowsRouter.get('/workflow-templates/:id', requirePermission('workflow.view'), asyncHandler(async (req, res) => {
  const template = await collections.workflowTemplates.getById(req.params.id);
  if (!template) throw notFound('Workflow template not found');
  res.json(template);
}));

workflowsRouter.post('/workflow-templates', requirePermission('workflow.manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = str(body.name);
  if (!name) throw badRequest('Template name is required');
  const projectTypeId = str(body.projectTypeId);
  if (!projectTypeId) throw badRequest('Project type is required');
  await validateProjectType(projectTypeId);

  const template = await collections.workflowTemplates.insert({
    name,
    description: str(body.description),
    projectTypeId,
    active: body.active !== false,
    tasks: normalizeTasks(body.tasks)
  });
  await logAudit({ user: req.user, action: 'create', entityType: 'workflowTemplate', entityId: template.id, entityLabel: name, details: `Template created with ${template.tasks.length} task(s)` });
  res.status(201).json(template);
}));

workflowsRouter.put('/workflow-templates/:id', requirePermission('workflow.manage'), asyncHandler(async (req, res) => {
  const template = await collections.workflowTemplates.getById(req.params.id);
  if (!template) throw notFound('Workflow template not found');
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    if (!str(body.name)) throw badRequest('Template name cannot be empty');
    patch.name = str(body.name);
  }
  if (body.description !== undefined) patch.description = str(body.description);
  if (body.projectTypeId !== undefined) {
    await validateProjectType(str(body.projectTypeId));
    patch.projectTypeId = str(body.projectTypeId);
  }
  if (body.active !== undefined) patch.active = !!body.active;
  if (body.tasks !== undefined) patch.tasks = normalizeTasks(body.tasks);

  const result = await collections.workflowTemplates.update(template.id, patch);
  await logAudit({
    user: req.user, action: 'update', entityType: 'workflowTemplate', entityId: template.id,
    entityLabel: result.after.name,
    details: 'Template updated (already created projects keep their own copy)'
  });
  res.json(result.after);
}));

workflowsRouter.post('/workflow-templates/:id/duplicate', requirePermission('workflow.manage'), asyncHandler(async (req, res) => {
  const template = await collections.workflowTemplates.getById(req.params.id);
  if (!template) throw notFound('Workflow template not found');
  const copy = await collections.workflowTemplates.insert({
    ...template,
    id: newId('wft'),
    name: `${template.name} (copy)`,
    tasks: normalizeTasks((template.tasks || []).map((t) => ({ ...t, id: null, steps: (t.steps || []).map((s) => ({ ...s, id: null })) }))),
    createdAt: nowIso()
  });
  await logAudit({ user: req.user, action: 'create', entityType: 'workflowTemplate', entityId: copy.id, entityLabel: copy.name, details: `Duplicated from "${template.name}"` });
  res.status(201).json(copy);
}));

workflowsRouter.patch('/workflow-templates/:id/status', requirePermission('workflow.manage'), asyncHandler(async (req, res) => {
  const template = await collections.workflowTemplates.getById(req.params.id);
  if (!template) throw notFound('Workflow template not found');
  const active = !!req.body?.active;
  const result = await collections.workflowTemplates.update(template.id, { active });
  await logAudit({ user: req.user, action: active ? 'activate' : 'deactivate', entityType: 'workflowTemplate', entityId: template.id, entityLabel: template.name });
  res.json(result.after);
}));

workflowsRouter.delete('/workflow-templates/:id', requirePermission('workflow.manage'), asyncHandler(async (req, res) => {
  const template = await collections.workflowTemplates.getById(req.params.id);
  if (!template) throw notFound('Workflow template not found');
  await collections.workflowTemplates.remove(template.id);
  await logAudit({ user: req.user, action: 'delete', entityType: 'workflowTemplate', entityId: template.id, entityLabel: template.name, details: 'Template deleted (existing projects are not affected)' });
  res.json({ ok: true });
}));
