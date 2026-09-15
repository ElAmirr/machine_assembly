// Project logic: create machine projects from workflow templates,
// compute progress / delays, machine history, cascade delete.
import { collections, nextCounter } from '../storage/db.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers } from '../core/notify.js';
import { deleteBlob } from '../storage/blobStore.js';
import {
  newId, nowIso, addDuration, durationToDays,
  str, strOrNull, toNum, idArray,
  badRequest, notFound
} from '../utils.js';

export function projectCode(seq) {
  return `PRJ-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
}

/** A task is "done" when completed (or approved for approval-required tasks). */
export function isTaskDone(task) {
  return ['completed', 'approved'].includes(task.status);
}

/** Task progress from its steps (or manual progress when the task has no steps). */
export function computeTaskProgress(task) {
  const steps = task.steps || [];
  if (steps.length === 0) {
    if (isTaskDone(task)) return 100;
    return Math.min(100, Math.max(0, Number(task.progress) || 0));
  }
  const done = steps.filter((s) => s.status === 'completed').length;
  return Math.round((done / steps.length) * 100);
}

/** Weighted project completion (longer tasks weigh more). */
export function computeProjectProgress(tasks) {
  if (!tasks.length) return 0;
  let weightSum = 0;
  let weighted = 0;
  for (const task of tasks) {
    const weight = Math.max(durationToDays(task.estimatedDuration, task.durationUnit), 0.5);
    weightSum += weight;
    weighted += weight * computeTaskProgress(task);
  }
  return Math.round(weighted / weightSum);
}

/** Derived flags used by the UI (blocked by dependencies, overdue, delayed). */
export function taskComputed(task, taskById) {
  const deps = (task.dependsOn || []).map((id) => (taskById?.get ? taskById.get(id) : null)).filter(Boolean);
  const blockedBy = deps
    .filter((dep) => dep.status !== 'completed' && dep.status !== 'approved')
    .map((dep) => ({ id: dep.id, name: dep.name, status: dep.status }));
  const now = Date.now();
  const done = isTaskDone(task);
  const overdue = !!(task.plannedEnd && !done && new Date(task.plannedEnd).getTime() < now);
  const delayed = !!(task.actualEnd && task.plannedEnd && new Date(task.actualEnd).getTime() > new Date(task.plannedEnd).getTime());
  return {
    progress: computeTaskProgress(task),
    blockedBy,
    canStart: blockedBy.length === 0,
    overdue,
    delayed
  };
}

function normalizeRequirement(rows, idKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      [idKey]: str(row[idKey]),
      quantity: toNum(row.quantity, 1),
      unit: str(row.unit),
      notes: str(row.notes)
    }))
    .filter((row) => row[idKey]);
}

function normalizeStepFromTemplate(step, index) {
  const measurement = step.measurement || {};
  return {
    id: newId('step'),
    order: index + 1,
    // Keeps the link to the template step so its instruction files stay visible in the project.
    sourceTemplateStepId: str(step.id) || null,
    title: str(step.title) || `Step ${index + 1}`,
    description: str(step.description),
    instructions: str(step.instructions),
    estimatedDuration: toNum(step.estimatedDuration, 0),
    durationUnit: step.durationUnit || 'days',
    roleId: strOrNull(step.roleId),
    assignedUserId: strOrNull(step.assignedUserId),
    components: normalizeRequirement(step.components, 'componentId'),
    tools: normalizeRequirement(step.tools, 'toolId'),
    evidenceRequired: step.evidenceRequired !== false,
    evidenceTypes: idArray(step.evidenceTypes),
    minFiles: toNum(step.minFiles, 1),
    maxFiles: toNum(step.maxFiles, null),
    measurement: {
      enabled: !!measurement.enabled,
      name: str(measurement.name),
      expected: toNum(measurement.expected, null),
      tolerance: Math.abs(toNum(measurement.tolerance, 0)) || 0,
      unit: str(measurement.unit),
      required: measurement.required !== false
    },
    approvalRequired: !!step.approvalRequired,
    status: 'not_started',
    startedAt: null,
    completedAt: null,
    completedBy: null,
    submittedAt: null,
    submittedBy: null,
    rejectionReason: null,
    completionNote: '',
    notes: str(step.notes)
  };
}

/**
 * Create a project. The selected template is COPIED into project tasks/steps,
 * so later template edits never change running projects (spec section 6/30).
 */
export async function createProject(input, user) {
  const machineName = str(input.machineName);
  if (!machineName) throw badRequest('Machine name is required');

  const projectTypeId = str(input.projectTypeId);
  if (!projectTypeId) throw badRequest('Project type is required');
  const projectType = await collections.projectTypes.getById(projectTypeId);
  if (!projectType) throw badRequest('Selected project type does not exist');

  let template = null;
  if (str(input.templateId)) {
    template = await collections.workflowTemplates.getById(str(input.templateId));
  } else {
    const templates = await collections.workflowTemplates.find(
      (t) => t.projectTypeId === projectTypeId && t.active !== false
    );
    template = templates.sort((a, b) => String(a.name).localeCompare(String(b.name)))[0] || null;
  }

  const seq = await nextCounter('project');
  const id = newId('project');
  const startDate = input.startDate ? new Date(input.startDate).toISOString() : nowIso();

  // Build project-specific copies of the template tasks + steps
  const tasks = [];
  const templateTaskIdMap = new Map();
  const templateTasks = [...(template?.tasks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  let cursor = startDate;
  templateTasks.forEach((tplTask, index) => {
    const taskId = newId('task');
    templateTaskIdMap.set(tplTask.id, taskId);
    const steps = [...(tplTask.steps || [])]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((step, stepIndex) => normalizeStepFromTemplate(step, stepIndex));

    const plannedStart = cursor;
    const plannedEnd = addDuration(plannedStart, toNum(tplTask.estimatedDuration, 0), tplTask.durationUnit || 'days');
    cursor = plannedEnd;

    tasks.push({
      id: taskId,
      projectId: id,
      order: index + 1,
      name: str(tplTask.name) || `Task ${index + 1}`,
      description: str(tplTask.description),
      roleId: strOrNull(tplTask.roleId),
      assignedUserId: strOrNull(tplTask.assignedUserId),
      estimatedDuration: toNum(tplTask.estimatedDuration, 0),
      durationUnit: tplTask.durationUnit || 'days',
      plannedStart,
      plannedEnd,
      actualStart: null,
      actualEnd: null,
      status: 'not_started',
      priority: input.priority || 'medium',
      dependsOn: [], // filled below after all ids exist
      approvalRequired: !!tplTask.approvalRequired,
      pendingTaskApproval: false,
      sequentialSteps: tplTask.sequentialSteps !== false,
      components: normalizeRequirement(tplTask.components, 'componentId'),
      tools: normalizeRequirement(tplTask.tools, 'toolId'),
      notes: '',
      progress: 0,
      steps,
      createdBy: user.id
    });
  });
  // Remap template dependency ids -> project task ids
  templateTasks.forEach((tplTask, index) => {
    tasks[index].dependsOn = idArray(tplTask.dependsOn)
      .map((tplId) => templateTaskIdMap.get(tplId))
      .filter(Boolean);
  });
  // Tasks without dependencies that are first in line become "ready"
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    const deps = (task.dependsOn || []).map((depId) => taskById.get(depId)).filter(Boolean);
    if (deps.length === 0) task.status = 'ready';
  }

  const plannedEndDate = input.plannedEndDate
    ? new Date(input.plannedEndDate).toISOString()
    : (tasks.length ? tasks[tasks.length - 1].plannedEnd : null);

  const project = {
    id,
    code: projectCode(seq),
    machineName,
    machineReference: str(input.machineReference),
    machineSerial: str(input.machineSerial),
    projectTypeId,
    templateId: template?.id || null,
    templateName: template?.name || null,
    description: str(input.description),
    productionLine: str(input.productionLine),
    departmentId: strOrNull(input.departmentId),
    locationId: strOrNull(input.locationId),
    responsibleUserId: strOrNull(input.responsibleUserId),
    startDate,
    plannedEndDate,
    actualEndDate: null,
    status: input.status || 'planned',
    priority: input.priority || 'medium',
    progress: 0,
    createdBy: user.id,
    updatedAt: nowIso()
  };

  await collections.projects.insert(project);
  if (tasks.length) await collections.tasks.insertMany(tasks);

  await logAudit({
    user, action: 'create', entityType: 'project', entityId: id, entityLabel: `${project.code} ${machineName}`,
    details: template ? `Created from workflow template "${template.name}" with ${tasks.length} task(s)` : 'Created without workflow template'
  });

  // Notify people that already have tasks assigned in this project
  const assignedUsers = [...new Set(tasks.map((t) => t.assignedUserId).filter(Boolean))];
  for (const userId of assignedUsers) {
    await notifyUsers([userId], {
      type: 'task_assigned',
      title: 'New project / task assigned',
      message: `${machineName} - new project ${project.code} was created with tasks assigned to you.`,
      link: `/projects/${id}`,
      entityType: 'project',
      entityId: id
    }, { excludeUserId: user.id });
  }

  return { project, tasks };
}

/** Recompute project progress + status from its tasks. */
export async function syncProjectProgress(projectId, { user = null } = {}) {
  const tasks = await collections.tasks.find({ projectId });
  const progress = computeProjectProgress(tasks);
  const update = await collections.projects.transaction((rows) => {
    const project = rows.find((p) => p.id === projectId);
    if (!project) return null;
    const before = { ...project };
    const allDone = tasks.length > 0 && tasks.every((t) => isTaskDone(t));
    const anyActive = tasks.some((t) => ['in_progress', 'submitted', 'rejected', 'waiting', 'blocked'].includes(t.status));
    project.progress = progress;
    if (allDone && !['completed', 'cancelled'].includes(project.status)) {
      project.status = 'completed';
      project.actualEndDate = project.actualEndDate || nowIso();
    } else if (anyActive && ['planned', 'not_started'].includes(project.status)) {
      project.status = 'in_progress';
    }
    project.updatedAt = nowIso();
    return { before, after: { ...project }, justCompleted: before.status !== 'completed' && project.status === 'completed' };
  });

  if (update?.justCompleted) {
    await logAudit({
      user, action: 'complete', entityType: 'project', entityId: projectId,
      entityLabel: update.after.code, details: 'All tasks completed - project marked as completed automatically'
    });
    await notifyUsers([update.after.responsibleUserId, update.after.createdBy], {
      type: 'project_completed',
      title: 'Project completed',
      message: `Project ${update.after.code} (${update.after.machineName}) is completed.`,
      link: `/projects/${projectId}`,
      entityType: 'project',
      entityId: projectId
    }, { excludeUserId: user?.id });
  }
  return update;
}

/** When dependencies finish, dependent "not started" tasks become "ready". */
export async function updateDependentStatuses(projectId) {
  await collections.tasks.transaction((rows) => {
    const taskById = new Map(rows.filter((t) => t.projectId === projectId).map((t) => [t.id, t]));
    for (const task of rows) {
      if (task.projectId !== projectId) continue;
      if (task.status !== 'not_started') continue;
      const deps = (task.dependsOn || []).map((id) => taskById.get(id)).filter(Boolean);
      if (deps.length > 0 && deps.every((d) => isTaskDone(d))) {
        task.status = 'ready';
      }
    }
  });
}

/** Previous projects of the same machine (spec section 39). */
export async function machineHistory(project) {
  const projects = await collections.projects.all();
  const key = (p) => (p.machineReference || p.machineName || '').toLowerCase();
  return projects
    .filter((p) => p.id !== project.id && key(p) === key(project))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Delete a project and everything that belongs to it (files included). */
export async function deleteProjectCascade(projectId) {
  const project = await collections.projects.getById(projectId);
  if (!project) throw notFound('Project not found');

  const tasks = await collections.tasks.find({ projectId });
  const attachments = await collections.attachments.find({ projectId });
  for (const att of attachments) {
    await deleteBlob(att.storedRel);
  }
  await collections.attachments.removeWhere({ projectId });
  await collections.evidence.removeWhere({ projectId });
  await collections.approvals.removeWhere({ projectId });
  await collections.comments.removeWhere({ projectId });
  await collections.tasks.removeWhere({ projectId });
  await collections.projects.remove(projectId);

  return { project, tasks: tasks.length, files: attachments.length };
}

/** Attach human-readable names + computed fields to a project. */
export function enrichProject(project, lookups, tasks = []) {
  if (!project) return null;
  const type = lookups.projectTypeById.get(project.projectTypeId);
  const department = lookups.departmentById.get(project.departmentId);
  const location = lookups.locationById.get(project.locationId);
  const now = Date.now();
  const overdue = !!(project.plannedEndDate && !['completed', 'cancelled'].includes(project.status)
    && new Date(project.plannedEndDate).getTime() < now);
  return {
    ...project,
    progress: computeProjectProgress(tasks),
    typeName: type?.name || project.projectTypeId,
    typeCode: type?.code || null,
    departmentName: department?.name || null,
    locationName: location?.name || null,
    responsibleName: lookups.userName(project.responsibleUserId),
    createdByName: lookups.userName(project.createdBy),
    overdue,
    tasksCount: tasks.length,
    tasksDone: tasks.filter((t) => isTaskDone(t)).length
  };
}
