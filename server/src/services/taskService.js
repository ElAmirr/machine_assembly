// Task + step execution engine:
// start / complete / evidence validation / approval workflow (spec sections 7-15, 23, 33-36).
import { collections } from '../storage/db.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers, notifyPermission } from '../core/notify.js';
import { saveBlob } from '../storage/blobStore.js';
import { isTaskDone, computeTaskProgress, syncProjectProgress, updateDependentStatuses } from './projectService.js';
import {
  newId, nowIso, str, strOrNull, toNum,
  badRequest, notFound, conflict, forbidden
} from '../utils.js';

// ---------------------------------------------------------------- helpers

function hasPerm(permissions, key) {
  return permissions.includes('*') || permissions.includes(key);
}

function assertCanWork(task, user, permissions) {
  if (!hasPerm(permissions, 'steps.complete') && !hasPerm(permissions, 'tasks.complete')) {
    throw forbidden('You do not have permission to work on tasks');
  }
  const isAssignee = !task.assignedUserId || task.assignedUserId === user.id;
  const isManager = hasPerm(permissions, 'tasks.edit') || hasPerm(permissions, 'tasks.override');
  if (!isAssignee && !isManager) {
    throw forbidden('This task is assigned to another person');
  }
}

function stepById(task, stepId) {
  return (task.steps || []).find((s) => s.id === stepId) || null;
}

function sortedSteps(task) {
  return [...(task.steps || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function sequentialPredecessor(task, step) {
  const steps = sortedSteps(task);
  const index = steps.findIndex((s) => s.id === step.id);
  return index > 0 ? steps[index - 1] : null;
}

/** Evaluate a measurement value against expected +- tolerance => 'pass' | 'fail' | null. */
export function evaluateMeasurement(measurement, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const expected = Number(measurement?.expected);
  if (!Number.isFinite(expected)) return null;
  const tolerance = Math.abs(Number(measurement?.tolerance) || 0);
  return Math.abs(numeric - expected) <= tolerance ? 'pass' : 'fail';
}

/** Evidence requirements check (spec sections 14, 35): used before allowing completion. */
export function validateStepRequirements(step, evidenceRows) {
  const errors = [];
  const fileItems = evidenceRows.filter((e) => e.attachmentId);
  const allowedTypes = step.evidenceTypes || [];

  if (step.evidenceRequired) {
    const min = Number(step.minFiles) > 0 ? Number(step.minFiles) : 1;
    if (fileItems.length < min) {
      errors.push(`At least ${min} file(s) of evidence required (currently ${fileItems.length}).`);
    }
    const max = Number(step.maxFiles) || null;
    if (max && fileItems.length > max) {
      errors.push(`Maximum ${max} file(s) allowed (currently ${fileItems.length}).`);
    }
    if (allowedTypes.length > 0) {
      const accepted = fileItems.filter((e) => allowedTypes.includes(e.type));
      if (accepted.length === 0 && min > 0) {
        errors.push(`Evidence must be one of: ${allowedTypes.join(', ')}.`);
      }
    }
  }

  const measurement = step.measurement || {};
  if (measurement.enabled && measurement.required) {
    const ok = evidenceRows.some(
      (e) => e.type === 'measurement' && e.measurement && e.measurement.value !== null && e.measurement.value !== undefined && e.measurement.result === 'pass'
    );
    if (!ok) {
      errors.push(`Measurement "${measurement.name || 'measurement'}" must be recorded and PASS the tolerance.`);
    }
  }
  return errors;
}

/** Recompute task state after a step changed. Returns flags for follow-up actions. */
function refreshTaskState(task) {
  const steps = task.steps || [];
  task.progress = computeTaskProgress(task);
  if (steps.length === 0) {
    return { allDone: isTaskDone(task), needTaskApproval: false };
  }
  const allDone = steps.every((s) => s.status === 'completed');
  if (allDone) {
    if (task.approvalRequired) {
      if (task.status !== 'submitted' && task.status !== 'approved') {
        task.status = 'submitted';
        const needTaskApproval = !task.pendingTaskApproval;
        task.pendingTaskApproval = true;
        return { allDone: true, needTaskApproval };
      }
      return { allDone: true, needTaskApproval: false };
    }
    task.status = 'completed';
    task.actualStart = task.actualStart || nowIso();
    task.actualEnd = task.actualEnd || nowIso();
    return { allDone: true, needTaskApproval: false };
  }
  // Not all steps done yet
  if (task.status === 'completed') task.status = 'in_progress';
  if (task.status === 'rejected') task.status = 'in_progress'; // technician is working again
  return { allDone: false, needTaskApproval: false };
}

async function notifyApprovers(task, project, step, actor) {
  const payload = {
    type: 'approval_requested',
    title: 'Approval requested',
    message: `${project?.machineName || ''} - ${project?.code || ''}: "${task.name}"${step ? ` / step "${step.title}"` : ''} was submitted for approval by ${actor.firstName || actor.username}.`,
    link: `/tasks/${task.id}`,
    entityType: 'task',
    entityId: task.id
  };
  await notifyPermission('approvals.approve', payload, { excludeUserId: actor.id });
  if (project?.responsibleUserId) {
    await notifyUsers([project.responsibleUserId], payload, { excludeUserId: actor.id });
  }
}

// ---------------------------------------------------------------- task actions

export async function startTask({ taskId, user, permissions }) {
  const task = await collections.tasks.getById(taskId);
  if (!task) throw notFound('Task not found');
  assertCanWork(task, user, permissions);
  if (isTaskDone(task)) throw conflict('This task is already completed');

  // Dependency check (spec section 23) - override needs tasks.override
  const allTasks = await collections.tasks.find({ projectId: task.projectId });
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const unmet = (task.dependsOn || [])
    .map((id) => taskById.get(id))
    .filter((dep) => dep && !isTaskDone(dep));
  if (unmet.length > 0 && !hasPerm(permissions, 'tasks.override')) {
    throw conflict(`Cannot start: waiting for "${unmet.map((d) => d.name).join('", "')}" to be completed first.`, unmet.map((d) => d.name));
  }

  const updated = await collections.tasks.transaction((rows) => {
    const doc = rows.find((t) => t.id === taskId);
    if (!doc) throw notFound('Task not found');
    if (doc.status === 'submitted') throw conflict('This task is waiting for approval');
    doc.status = 'in_progress';
    doc.actualStart = doc.actualStart || nowIso();
    return structuredClone(doc);
  });

  await logAudit({ user, action: 'start', entityType: 'task', entityId: taskId, entityLabel: updated.name, details: 'Task started' });
  await syncProjectProgress(task.projectId, { user });
  return updated;
}

export async function startStep({ taskId, stepId, user, permissions }) {
  const task = await collections.tasks.getById(taskId);
  if (!task) throw notFound('Task not found');
  assertCanWork(task, user, permissions);
  const step = stepById(task, stepId);
  if (!step) throw notFound('Step not found');
  if (step.status === 'completed') throw conflict('This step is already completed');
  if (step.status === 'submitted') throw conflict('This step is waiting for approval');
  if (task.sequentialSteps !== false) {
    const prev = sequentialPredecessor(task, step);
    if (prev && prev.status !== 'completed' && !hasPerm(permissions, 'tasks.override')) {
      throw conflict(`This step is locked until "${prev.title}" is completed.`);
    }
  }

  const updated = await collections.tasks.transaction((rows) => {
    const doc = rows.find((t) => t.id === taskId);
    if (!doc) throw notFound('Task not found');
    const docStep = stepById(doc, stepId);
    if (!docStep) throw notFound('Step not found');
    docStep.status = 'in_progress';
    docStep.startedAt = docStep.startedAt || nowIso();
    docStep.rejectionReason = null;
    if (['not_started', 'ready', 'rejected'].includes(doc.status)) doc.status = 'in_progress';
    doc.actualStart = doc.actualStart || nowIso();
    return structuredClone(doc);
  });

  await logAudit({ user, action: 'start', entityType: 'step', entityId: stepId, entityLabel: `${task.name} - ${step.title}`, details: 'Step started' });
  await syncProjectProgress(task.projectId, { user });
  return updated;
}

/**
 * Complete a step. Validates sequential locking + evidence requirements.
 * When approvalRequired, the step goes to "submitted" instead of completed.
 */
export async function completeStep({ taskId, stepId, user, permissions, note = '', force = false }) {
  const outcome = await collections.tasks.transaction(async (rows) => {
    const task = rows.find((t) => t.id === taskId);
    if (!task) throw notFound('Task not found');
    assertCanWork(task, user, permissions);
    const step = stepById(task, stepId);
    if (!step) throw notFound('Step not found');
    if (step.status === 'completed') throw conflict('This step is already completed');
    if (step.status === 'submitted') throw conflict('This step is waiting for approval');
    if (task.sequentialSteps !== false) {
      const prev = sequentialPredecessor(task, step);
      if (prev && prev.status !== 'completed' && !hasPerm(permissions, 'tasks.override')) {
        throw conflict(`This step is locked until "${prev.title}" is completed.`);
      }
    }

    // Evidence validation (fresh read of this step's evidence)
    const stepEvidence = (await collections.evidence.all()).filter((e) => e.stepId === step.id);
    const problems = validateStepRequirements(step, stepEvidence);
    if (problems.length > 0) {
      if (!force) throw conflict('Required evidence is missing or invalid.', problems);
      if (!hasPerm(permissions, 'tasks.override')) {
        throw forbidden('You cannot skip evidence requirements.', problems);
      }
    }

    if (step.approvalRequired && !force) {
      step.status = 'submitted';
      step.submittedAt = nowIso();
      step.submittedBy = user.id;
    } else {
      step.status = 'completed';
      step.completedAt = nowIso();
      step.completedBy = user.id;
      step.rejectionReason = null;
    }
    step.completionNote = str(note) || step.completionNote || '';
    const decision = { stepApproval: step.approvalRequired && !force, stepTitle: step.title };
    const state = refreshTaskState(task);
    return { task: structuredClone(task), taskName: task.name, projectId: task.projectId, decision, state };
  });

  const { task, decision, state } = outcome;

  if (decision.stepApproval) {
    await collections.approvals.insert({
      id: newId('apr'), projectId: task.projectId, taskId: task.id, stepId,
      scope: 'step', stepTitle: decision.stepTitle, taskName: task.name,
      submittedBy: user.id, submittedAt: nowIso(), status: 'submitted',
      reviewedBy: null, reviewedAt: null, reason: ''
    });
    const project = await collections.projects.getById(task.projectId);
    await notifyApprovers(task, project, { title: decision.stepTitle }, user);
    await logAudit({ user, action: 'submit', entityType: 'step', entityId: stepId, entityLabel: `${task.name} - ${decision.stepTitle}`, details: 'Submitted for approval' });
  } else {
    await logAudit({ user, action: 'complete', entityType: 'step', entityId: stepId, entityLabel: `${task.name} - ${decision.stepTitle}`, details: str(note) || null });
  }

  if (state.needTaskApproval) {
    await collections.approvals.insert({
      id: newId('apr'), projectId: task.projectId, taskId: task.id, stepId: null,
      scope: 'task', stepTitle: null, taskName: task.name,
      submittedBy: user.id, submittedAt: nowIso(), status: 'submitted',
      reviewedBy: null, reviewedAt: null, reason: ''
    });
    const project = await collections.projects.getById(task.projectId);
    await notifyApprovers(task, project, null, user);
    await logAudit({ user, action: 'submit', entityType: 'task', entityId: task.id, entityLabel: task.name, details: 'All steps completed - submitted for task approval' });
  }

  await updateDependentStatuses(task.projectId);
  await syncProjectProgress(task.projectId, { user });

  if (isTaskDone(task)) {
    const project = await collections.projects.getById(task.projectId);
    await notifyUsers([project?.responsibleUserId, project?.createdBy], {
      type: 'task_completed',
      title: 'Task completed',
      message: `${project?.machineName || ''}: task "${task.name}" is completed.`,
      link: `/tasks/${task.id}`,
      entityType: 'task',
      entityId: task.id
    }, { excludeUserId: user.id });
  }

  return collections.tasks.getById(taskId);
}

/** Complete a whole task (used for tasks without steps or after manual verification). */
export async function completeTask({ taskId, user, permissions, note = '', force = false }) {
  const outcome = await collections.tasks.transaction((rows) => {
    const task = rows.find((t) => t.id === taskId);
    if (!task) throw notFound('Task not found');
    assertCanWork(task, user, permissions);
    if (isTaskDone(task)) throw conflict('This task is already completed');
    if (task.status === 'submitted') throw conflict('This task is waiting for approval');

    const steps = task.steps || [];
    const allStepsDone = steps.length > 0 && steps.every((s) => s.status === 'completed');
    if (steps.length > 0 && !allStepsDone) {
      if (!force) throw conflict('Not all steps are completed yet.');
      if (!hasPerm(permissions, 'tasks.override')) throw forbidden('You cannot complete this task before all steps are done.');
      steps.forEach((s) => {
        if (s.status !== 'completed') {
          s.status = 'completed';
          s.completedAt = nowIso();
          s.completedBy = user.id;
          s.completionNote = 'Completed with override';
        }
      });
    }

    let needTaskApproval = false;
    if (task.approvalRequired && !force) {
      task.status = 'submitted';
      needTaskApproval = !task.pendingTaskApproval;
      task.pendingTaskApproval = true;
    } else {
      task.status = 'completed';
      task.pendingTaskApproval = false;
      task.actualStart = task.actualStart || nowIso();
      task.actualEnd = nowIso();
    }
    task.progress = computeTaskProgress(task);
    if (note) task.completionNote = str(note);
    return { task: structuredClone(task), projectId: task.projectId, needTaskApproval };
  });

  const { task, needTaskApproval } = outcome;
  if (needTaskApproval) {
    await collections.approvals.insert({
      id: newId('apr'), projectId: task.projectId, taskId: task.id, stepId: null,
      scope: 'task', stepTitle: null, taskName: task.name,
      submittedBy: user.id, submittedAt: nowIso(), status: 'submitted',
      reviewedBy: null, reviewedAt: null, reason: ''
    });
    const project = await collections.projects.getById(task.projectId);
    await notifyApprovers(task, project, null, user);
    await logAudit({ user, action: 'submit', entityType: 'task', entityId: taskId, entityLabel: task.name, details: 'Submitted for approval' });
  } else {
    await logAudit({ user, action: 'complete', entityType: 'task', entityId: taskId, entityLabel: task.name, details: str(note) || null });
  }

  await updateDependentStatuses(task.projectId);
  await syncProjectProgress(task.projectId, { user });
  return collections.tasks.getById(taskId);
}

/** Approve or reject a submitted step/task (spec section 15). */
export async function reviewApproval({ approvalId, decision, reason = '', user }) {
  const approval = await collections.approvals.getById(approvalId);
  if (!approval) throw notFound('Approval record not found');
  if (approval.status !== 'submitted') throw conflict('This approval was already reviewed');
  if (!['approved', 'rejected'].includes(decision)) throw badRequest('Decision must be "approved" or "rejected"');
  if (decision === 'rejected' && !str(reason)) throw badRequest('A rejection reason is required');

  await collections.approvals.update(approvalId, {
    status: decision,
    reviewedBy: user.id,
    reviewedAt: nowIso(),
    reason: str(reason)
  });

  const outcome = await collections.tasks.transaction((rows) => {
    const task = rows.find((t) => t.id === approval.taskId);
    if (!task) throw notFound('Task not found');

    if (approval.scope === 'step') {
      const step = stepById(task, approval.stepId);
      if (!step) throw notFound('Step not found');
      if (decision === 'approved') {
        step.status = 'completed';
        step.completedAt = step.completedAt || nowIso();
        step.completedBy = step.completedBy || approval.submittedBy;
        step.rejectionReason = null;
      } else {
        step.status = 'rejected';
        step.rejectionReason = str(reason);
      }
    } else {
      task.pendingTaskApproval = false;
      if (decision === 'approved') {
        task.status = 'approved';
        task.actualStart = task.actualStart || nowIso();
        task.actualEnd = task.actualEnd || nowIso();
      } else {
        task.status = 'rejected';
        task.rejectionReason = str(reason);
      }
    }
    const state = refreshTaskState(task);
    return { task: structuredClone(task), state };
  });

  const { task, state } = outcome;

  if (state.needTaskApproval) {
    await collections.approvals.insert({
      id: newId('apr'), projectId: task.projectId, taskId: task.id, stepId: null,
      scope: 'task', stepTitle: null, taskName: task.name,
      submittedBy: user.id, submittedAt: nowIso(), status: 'submitted',
      reviewedBy: null, reviewedAt: null, reason: ''
    });
  }

  // Notify the submitter about the decision
  const project = await collections.projects.getById(task.projectId);
  const label = approval.scope === 'step' ? `step "${approval.stepTitle}" of task "${task.name}"` : `task "${task.name}"`;
  await notifyUsers([approval.submittedBy], {
    type: decision === 'approved' ? 'step_approved' : 'step_rejected',
    title: decision === 'approved' ? 'Work approved' : 'Work rejected',
    message: `${project?.machineName || ''} - your ${label} was ${decision}.${decision === 'rejected' ? ` Reason: ${str(reason)}` : ''}`,
    link: `/tasks/${task.id}`,
    entityType: 'task',
    entityId: task.id
  }, { excludeUserId: user.id });

  await logAudit({
    user,
    action: decision === 'approved' ? 'approve' : 'reject',
    entityType: approval.scope === 'step' ? 'step' : 'task',
    entityId: approval.scope === 'step' ? approval.stepId : approval.taskId,
    entityLabel: `${task.name}${approval.stepTitle ? ` - ${approval.stepTitle}` : ''}`,
    details: decision === 'rejected' ? `Rejected: ${str(reason)}` : 'Approved'
  });

  await updateDependentStatuses(task.projectId);
  await syncProjectProgress(task.projectId, { user });

  if (isTaskDone(task)) {
    await notifyUsers([project?.responsibleUserId, project?.createdBy], {
      type: 'task_completed',
      title: 'Task completed',
      message: `${project?.machineName || ''}: task "${task.name}" is completed.`,
      link: `/tasks/${task.id}`,
      entityType: 'task',
      entityId: task.id
    }, { excludeUserId: user.id });
  }
  return { approval: await collections.approvals.getById(approvalId), task: await collections.tasks.getById(task.id) };
}

// ---------------------------------------------------------------- evidence

/** Add a piece of evidence to a step: file | measurement | comment | checklist. */
export async function addEvidence({ taskId, stepId, user, permissions, type, file, measurement, checklist, comment, description = '' }) {
  const task = await collections.tasks.getById(taskId);
  if (!task) throw notFound('Task not found');
  const step = stepById(task, stepId);
  if (!step) throw notFound('Step not found');
  if (!hasPerm(permissions, 'attachments.upload')) throw forbidden('You do not have permission to upload evidence');
  if (step.status === 'completed') throw conflict('This step is already completed - reopen it before adding more evidence');
  if (step.status === 'submitted') throw conflict('This step is waiting for approval - evidence cannot be changed');

  const evidenceType = str(type);
  if (!evidenceType) throw badRequest('Evidence type is required');
  const configured = step.evidenceTypes || [];
  if (configured.length > 0 && !configured.includes(evidenceType)) {
    throw badRequest(`Evidence type "${evidenceType}" is not enabled for this step (allowed: ${configured.join(', ')})`);
  }

  let attachmentId = null;
  let measurementData = null;
  let checklistData = null;
  let commentText = '';

  if (file) {
    const saved = await saveBlob(file.buffer, file.originalname);
    const attachment = await collections.attachments.insert({
      id: newId('att'),
      ownerType: 'step',
      ownerId: stepId,
      projectId: task.projectId,
      taskId: task.id,
      filename: str(file.originalname) || 'file',
      storedRel: saved.storedRel,
      ext: (file.originalname.match(/\.[^.]*$/)?.[0] || '').toLowerCase(),
      mimeType: file.mimetype || 'application/octet-stream',
      size: saved.size,
      version: 1,
      previousId: null,
      description: str(description),
      uploadedBy: user.id
    });
    attachmentId = attachment.id;
  } else if (evidenceType === 'measurement') {
    const value = toNum(measurement?.value, null);
    if (value === null) throw badRequest('Measurement value is required');
    const config = step.measurement || {};
    measurementData = {
      name: str(measurement?.name) || str(config.name),
      expected: toNum(measurement?.expected, config.expected ?? null),
      tolerance: Math.abs(toNum(measurement?.tolerance, config.tolerance ?? 0)) || 0,
      unit: str(measurement?.unit) || str(config.unit),
      value,
      result: evaluateMeasurement({ expected: toNum(measurement?.expected, config.expected ?? null), tolerance: toNum(measurement?.tolerance, config.tolerance ?? 0) }, value)
    };
  } else if (evidenceType === 'checklist') {
    const items = Array.isArray(checklist) ? checklist : [];
    if (items.length === 0) throw badRequest('Checklist items are required');
    checklistData = items.map((item) => ({ label: str(item.label), checked: !!item.checked }));
  } else if (evidenceType === 'comment') {
    if (!str(comment)) throw badRequest('Comment text is required');
    commentText = str(comment);
  } else {
    throw badRequest('A file is required for this evidence type');
  }

  const evidence = await collections.evidence.insert({
    id: newId('evd'),
    projectId: task.projectId,
    taskId: task.id,
    stepId,
    type: evidenceType,
    attachmentId,
    measurement: measurementData,
    checklist: checklistData,
    comment: commentText,
    createdBy: user.id
  });

  await logAudit({
    user, action: 'upload_evidence', entityType: 'step', entityId: stepId,
    entityLabel: `${task.name} - ${step.title}`,
    details: file ? `Evidence uploaded: ${file.originalname}` : `Evidence added: ${evidenceType}`
  });
  return evidence;
}

export async function deleteEvidence({ evidenceId, user, permissions }) {
  const evidence = await collections.evidence.getById(evidenceId);
  if (!evidence) throw notFound('Evidence not found');
  const isOwner = evidence.createdBy === user.id;
  if (!isOwner && !hasPerm(permissions, 'attachments.manage')) {
    throw forbidden('Only the uploader or a manager can delete this evidence');
  }
  const task = await collections.tasks.getById(evidence.taskId);
  const step = task ? stepById(task, evidence.stepId) : null;
  if (step && ['completed', 'submitted'].includes(step.status) && !hasPerm(permissions, 'attachments.manage')) {
    throw conflict('This step is finished - a manager permission is required to change its evidence');
  }

  if (evidence.attachmentId) {
    const attachment = await collections.attachments.getById(evidence.attachmentId);
    if (attachment) {
      const { deleteBlob } = await import('../storage/blobStore.js');
      await deleteBlob(attachment.storedRel);
      await collections.attachments.remove(attachment.id);
    }
  }
  await collections.evidence.remove(evidenceId);
  await logAudit({ user, action: 'delete', entityType: 'evidence', entityId: evidenceId, entityLabel: task?.name || '', details: `Evidence removed (${evidence.type})` });
  return evidence;
}
