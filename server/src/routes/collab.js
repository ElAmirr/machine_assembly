// Collaboration: attachments (spec 13), comments (spec 27), notifications (spec 25).
import { Router } from 'express';
import fs from 'node:fs/promises';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers } from '../core/notify.js';
import { upload } from '../middleware/upload.js';
import { saveBlob, deleteBlob, blobAbsPath, blobExists } from '../storage/blobStore.js';
import { newId, asyncHandler, badRequest, notFound, forbidden, conflict, str, toBool } from '../utils.js';
import { serializeAttachment } from './projects.js';
import { buildLookups } from '../services/lookups.js';

export const collabRouter = Router();
collabRouter.use(requireAuth);

// ------------------------------------------------------------ ATTACHMENTS

/** Resolve owner -> { projectId, taskId } and validate it exists. */
async function resolveOwner(ownerType, ownerId) {
  if (ownerType === 'project') {
    const project = await collections.projects.getById(ownerId);
    if (!project) throw notFound('Project not found');
    return { projectId: project.id, taskId: null, label: `${project.code} ${project.machineName}` };
  }
  if (ownerType === 'task') {
    const task = await collections.tasks.getById(ownerId);
    if (!task) throw notFound('Task not found');
    return { projectId: task.projectId, taskId: task.id, label: task.name };
  }
  if (ownerType === 'step') {
    const tasks = await collections.tasks.all();
    for (const task of tasks) {
      const step = (task.steps || []).find((s) => s.id === ownerId);
      if (step) return { projectId: task.projectId, taskId: task.id, label: `${task.name} - ${step.title}` };
    }
    throw notFound('Step not found');
  }
  if (ownerType === 'template_step') {
    // Instruction files (work-instruction photos/PDFs) attached to a step of a workflow template.
    const templates = await collections.workflowTemplates.all();
    for (const template of templates) {
      for (const task of template.tasks || []) {
        const step = (task.steps || []).find((s) => s.id === ownerId);
        if (step) return { projectId: null, taskId: null, templateId: template.id, label: `${template.name} - ${step.title}` };
      }
    }
    throw notFound('Workflow step not found');
  }
  throw badRequest('ownerType must be project, task, step or template_step');
}

collabRouter.post('/attachments', requirePermission('attachments.upload'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('A file is required');
  const ownerType = str(req.body?.ownerType);
  const ownerId = str(req.body?.ownerId);
  const owner = await resolveOwner(ownerType, ownerId);
  // Instruction files on workflow steps are managed like the workflow itself (admin / workflow managers).
  if (ownerType === 'template_step' && !(req.permissions.includes('*') || req.permissions.includes('workflow.manage'))) {
    throw forbidden('Only workflow managers can attach instruction files to workflow steps');
  }

  const saved = await saveBlob(req.file.buffer, req.file.originalname);
  const attachment = await collections.attachments.insert({
    id: newId('att'),
    ownerType,
    ownerId,
    projectId: owner.projectId,
    taskId: owner.taskId,
    templateId: owner.templateId || null,
    filename: str(req.file.originalname) || 'file',
    storedRel: saved.storedRel,
    ext: (req.file.originalname.match(/\.[^.]*$/)?.[0] || '').toLowerCase(),
    mimeType: req.file.mimetype || 'application/octet-stream',
    size: saved.size,
    version: 1,
    previousId: null,
    description: str(req.body?.description),
    uploadedBy: req.user.id,
    uploadedAt: new Date().toISOString()
  });

  await logAudit({
    user: req.user, action: 'upload', entityType: ownerType, entityId: ownerId,
    entityLabel: owner.label, details: `File uploaded: ${attachment.filename} (${attachment.mimeType})`
  });
  res.status(201).json({ ...serializeAttachment(attachment), uploadedByName: `${req.user.firstName} ${req.user.lastName}`.trim() });
}));

collabRouter.get('/attachments', requirePermission('attachments.view'), asyncHandler(async (req, res) => {
  const { ownerType, ownerId, projectId, taskId } = req.query;
  const lookups = await buildLookups();
  let rows;
  if (ownerType && ownerId) rows = await collections.attachments.find({ ownerType: str(ownerType), ownerId: str(ownerId) });
  else if (ownerType) rows = await collections.attachments.find({ ownerType: str(ownerType) });
  else if (taskId) rows = await collections.attachments.find({ taskId: str(taskId) });
  else if (projectId) rows = await collections.attachments.find({ projectId: str(projectId) });
  else rows = await collections.attachments.all();
  rows = rows
    .sort((a, b) => String(b.uploadedAt || b.createdAt).localeCompare(String(a.uploadedAt || a.createdAt)))
    .map((a) => ({ ...serializeAttachment(a), uploadedByName: lookups.userName(a.uploadedBy) }));
  res.json(rows);
}));

collabRouter.put('/attachments/:id', requirePermission('attachments.upload'), asyncHandler(async (req, res) => {
  const attachment = await collections.attachments.getById(req.params.id);
  if (!attachment) throw notFound('Attachment not found');
  const isUploader = attachment.uploadedBy === req.user.id;
  if (!isUploader && !(req.permissions.includes('*') || req.permissions.includes('attachments.manage'))) {
    throw forbidden('Only the uploader or a manager can edit this file');
  }
  const result = await collections.attachments.update(attachment.id, {
    description: str(req.body?.description),
    filename: req.body?.filename !== undefined ? str(req.body.filename) || attachment.filename : attachment.filename
  });
  res.json(serializeAttachment(result.after));
}));

/** Upload a new version of an attachment (spec section 13: replace/update version). */
collabRouter.post('/attachments/:id/replace', requirePermission('attachments.upload'), upload.single('file'), asyncHandler(async (req, res) => {
  const old = await collections.attachments.getById(req.params.id);
  if (!old) throw notFound('Attachment not found');
  if (!req.file) throw badRequest('A file is required');
  const isUploader = old.uploadedBy === req.user.id;
  if (!isUploader && !(req.permissions.includes('*') || req.permissions.includes('attachments.manage'))) {
    throw forbidden('Only the uploader or a manager can replace this file');
  }

  const saved = await saveBlob(req.file.buffer, req.file.originalname);
  const next = await collections.attachments.insert({
    id: newId('att'),
    ownerType: old.ownerType,
    ownerId: old.ownerId,
    projectId: old.projectId,
    taskId: old.taskId,
    filename: str(req.file.originalname) || old.filename,
    storedRel: saved.storedRel,
    ext: (req.file.originalname.match(/\.[^.]*$/)?.[0] || '').toLowerCase(),
    mimeType: req.file.mimetype || 'application/octet-stream',
    size: saved.size,
    version: (Number(old.version) || 1) + 1,
    previousId: old.id,
    description: str(req.body?.description) || old.description,
    uploadedBy: req.user.id,
    uploadedAt: new Date().toISOString()
  });

  await logAudit({
    user: req.user, action: 'upload', entityType: old.ownerType, entityId: old.ownerId,
    entityLabel: old.filename, details: `New version v${next.version} uploaded (replaces ${old.filename})`
  });
  res.status(201).json(serializeAttachment(next));
}));

async function sendFile(req, res, disposition) {
  const attachment = await collections.attachments.getById(req.params.id);
  if (!attachment) throw notFound('Attachment not found');
  const abs = blobAbsPath(attachment.storedRel);
  if (!(await blobExists(attachment.storedRel))) throw notFound('The file is missing from the shared folder');
  const safeName = attachment.filename.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(safeName)}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );
  res.sendFile(abs);
}

collabRouter.get('/attachments/:id/download', requirePermission('attachments.view'), asyncHandler(async (req, res) => {
  await sendFile(req, res, 'attachment');
}));

collabRouter.get('/attachments/:id/preview', requirePermission('attachments.view'), asyncHandler(async (req, res) => {
  await sendFile(req, res, 'inline');
}));

collabRouter.delete('/attachments/:id', requireAuth, asyncHandler(async (req, res) => {
  const attachment = await collections.attachments.getById(req.params.id);
  if (!attachment) throw notFound('Attachment not found');
  const isUploader = attachment.uploadedBy === req.user.id;
  if (!isUploader && !(req.permissions.includes('*') || req.permissions.includes('attachments.manage'))) {
    throw forbidden('Only the uploader or a manager can delete this file');
  }
  // Remove evidence rows pointing at it, then the file itself.
  await collections.evidence.removeWhere({ attachmentId: attachment.id });
  await deleteBlob(attachment.storedRel);
  await collections.attachments.remove(attachment.id);
  await logAudit({ user: req.user, action: 'delete', entityType: attachment.ownerType, entityId: attachment.ownerId, entityLabel: attachment.filename, details: 'File deleted' });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ COMMENTS

async function commentParticipants({ projectId, taskId, stepId }) {
  const ids = new Set();
  const project = projectId ? await collections.projects.getById(projectId) : null;
  if (project) {
    if (project.responsibleUserId) ids.add(project.responsibleUserId);
    if (project.createdBy) ids.add(project.createdBy);
  }
  if (taskId) {
    const task = await collections.tasks.getById(taskId);
    if (task) {
      if (task.assignedUserId) ids.add(task.assignedUserId);
      for (const step of task.steps || []) {
        if (step.assignedUserId) ids.add(step.assignedUserId);
      }
    }
  }
  if (stepId) {
    const tasks = await collections.tasks.all();
    for (const task of tasks) {
      const step = (task.steps || []).find((s) => s.id === stepId);
      if (step) {
        if (step.assignedUserId) ids.add(step.assignedUserId);
        break;
      }
    }
  }
  const previous = await collections.comments.find((c) => (taskId && c.taskId === taskId) || (projectId && c.projectId === projectId));
  for (const comment of previous) ids.add(comment.userId);
  return [...ids];
}

collabRouter.get('/comments', requireAuth, asyncHandler(async (req, res) => {
  const { ownerType, ownerId, taskId, projectId } = req.query;
  const lookups = await buildLookups();
  let rows;
  if (ownerType && ownerId) rows = await collections.comments.find({ ownerType: str(ownerType), ownerId: str(ownerId) });
  else if (taskId) rows = await collections.comments.find({ taskId: str(taskId) });
  else if (projectId) rows = await collections.comments.find({ projectId: str(projectId) });
  else rows = await collections.comments.all();
  rows = rows
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((c) => ({ ...c, userName: lookups.userName(c.userId) }));
  res.json(rows);
}));

collabRouter.post('/comments', requireAuth, asyncHandler(async (req, res) => {
  const ownerType = str(req.body?.ownerType);
  const ownerId = str(req.body?.ownerId);
  const message = str(req.body?.message);
  if (!message) throw badRequest('Message is required');
  const owner = await resolveOwner(ownerType, ownerId);

  const comment = await collections.comments.insert({
    id: newId('cmt'),
    ownerType,
    ownerId,
    projectId: owner.projectId,
    taskId: owner.taskId,
    userId: req.user.id,
    message,
    createdAt: new Date().toISOString()
  });

  const participants = await commentParticipants({ projectId: owner.projectId, taskId: owner.taskId, stepId: ownerType === 'step' ? ownerId : null });
  await notifyUsers(participants, {
    type: 'comment_added',
    title: 'New comment',
    message: `${req.user.firstName || req.user.username} commented on ${owner.label}: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`,
    link: owner.taskId ? `/tasks/${owner.taskId}` : `/projects/${owner.projectId}`,
    entityType: ownerType,
    entityId: ownerId
  }, { excludeUserId: req.user.id });

  res.status(201).json({ ...comment, userName: `${req.user.firstName} ${req.user.lastName}`.trim() });
}));

// ------------------------------------------------------------ NOTIFICATIONS

collabRouter.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  let rows = await collections.notifications.find({ userId: req.user.id });
  if (toBool(req.query?.unread)) rows = rows.filter((n) => !n.read);
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const limit = Math.min(Number(req.query?.limit) || 100, 500);
  res.json(rows.slice(0, limit));
}));

collabRouter.get('/notifications/count', requireAuth, asyncHandler(async (req, res) => {
  const rows = await collections.notifications.find({ userId: req.user.id });
  res.json({ unread: rows.filter((n) => !n.read).length });
}));

collabRouter.post('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notification = await collections.notifications.getById(req.params.id);
  if (!notification || notification.userId !== req.user.id) throw notFound('Notification not found');
  const result = await collections.notifications.update(notification.id, { read: true });
  res.json(result.after);
}));

collabRouter.post('/notifications/read-all', requireAuth, asyncHandler(async (req, res) => {
  await collections.notifications.transaction((rows) => {
    for (const row of rows) {
      if (row.userId === req.user.id) row.read = true;
    }
  });
  res.json({ ok: true });
}));
