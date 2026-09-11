// Administration module: people, roles, departments, locations, project types,
// evidence types, settings, storage + backups (spec section 29).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { collections, readSettings, writeSettings, nextCounter, dataFolderStatus } from '../storage/db.js';
import { requireAuth, requirePermission, publicUser } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { notifyUsers } from '../core/notify.js';
import { createBackup, listBackups } from '../storage/backup.js';
import { config } from '../config.js';
import { ALL_PERMISSION_KEYS, DEFAULT_SETTINGS } from '../constants.js';
import { asyncHandler, badRequest, conflict, notFound, str, strOrNull, idArray, pick } from '../utils.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

const BCRYPT_ROUNDS = 10;

function userWithRoles(user, roles, departments) {
  const base = publicUser(user, roles);
  if (!base) return null;
  const department = departments.find((d) => d.id === user.departmentId);
  return { ...base, departmentName: department?.name || null };
}

async function assertUsernameFree(username, exceptId = null) {
  const users = await collections.users.all();
  const clash = users.find((u) => String(u.username).toLowerCase() === username.toLowerCase() && u.id !== exceptId);
  if (clash) throw conflict(`Username "${username}" is already used`);
}

async function isLastAdmin(userId) {
  const [users, roles] = await Promise.all([collections.users.all(), collections.roles.all()]);
  const adminRoleIds = new Set(roles.filter((r) => (r.permissions || []).includes('*')).map((r) => r.id));
  const admins = users.filter((u) => u.active !== false && (u.roleIds || []).some((id) => adminRoleIds.has(id)));
  return admins.length === 1 && admins[0].id === userId;
}

// ------------------------------------------------------------------ PEOPLE

adminRouter.get('/users', requirePermission('users.view'), asyncHandler(async (req, res) => {
  const [users, roles, departments] = await Promise.all([
    collections.users.all(), collections.roles.all(), collections.departments.all()
  ]);
  const { roleId, departmentId, status, q } = req.query;
  const term = str(q).toLowerCase();
  let rows = users.map((u) => userWithRoles(u, roles, departments));
  if (roleId) rows = rows.filter((u) => (u.roleIds || []).includes(str(roleId)));
  if (departmentId) rows = rows.filter((u) => u.departmentId === str(departmentId));
  if (status === 'active') rows = rows.filter((u) => u.active !== false);
  if (status === 'inactive') rows = rows.filter((u) => u.active === false);
  if (term) {
    rows = rows.filter((u) =>
      [u.firstName, u.lastName, u.username, u.email, u.phone].some((v) => String(v || '').toLowerCase().includes(term))
    );
  }
  rows.sort((a, b) => String(a.firstName).localeCompare(String(b.firstName)));
  res.json(rows);
}));

adminRouter.get('/users/:id', requirePermission('users.view'), asyncHandler(async (req, res) => {
  const [user, roles, departments] = await Promise.all([
    collections.users.getById(req.params.id), collections.roles.all(), collections.departments.all()
  ]);
  if (!user) throw notFound('User not found');
  res.json(userWithRoles(user, roles, departments));
}));

adminRouter.post('/users', requirePermission('users.create'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const username = str(body.username);
  const password = str(body.password);
  if (!str(body.firstName)) throw badRequest('First name is required');
  if (!username) throw badRequest('Username is required');
  if (password.length < 6) throw badRequest('Password must be at least 6 characters');
  await assertUsernameFree(username);

  const roles = await collections.roles.all();
  const roleIds = idArray(body.roleIds).filter((id) => roles.some((r) => r.id === id));
  if (roleIds.length === 0) throw badRequest('At least one role is required');

  const user = await collections.users.insert({
    firstName: str(body.firstName),
    lastName: str(body.lastName),
    username,
    email: str(body.email),
    phone: str(body.phone),
    roleIds,
    departmentId: strOrNull(body.departmentId),
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    active: body.active !== false,
    lastLogin: null
  });
  await logAudit({ user: req.user, action: 'create', entityType: 'user', entityId: user.id, entityLabel: username, details: 'User created' });
  res.status(201).json(userWithRoles(user, roles, await collections.departments.all()));
}));

adminRouter.put('/users/:id', requirePermission('users.edit'), asyncHandler(async (req, res) => {
  const target = await collections.users.getById(req.params.id);
  if (!target) throw notFound('User not found');
  const body = req.body || {};

  if (body.username !== undefined) {
    const username = str(body.username);
    if (!username) throw badRequest('Username cannot be empty');
    await assertUsernameFree(username, target.id);
  }
  if (body.active === false && target.id === req.user.id) throw badRequest('You cannot deactivate your own account');

  const roles = await collections.roles.all();
  const patch = pick(body, ['firstName', 'lastName', 'email', 'phone']);
  if (body.username !== undefined) patch.username = str(body.username);
  if (body.departmentId !== undefined) patch.departmentId = strOrNull(body.departmentId);
  if (body.active !== undefined) patch.active = !!body.active;
  if (body.roleIds !== undefined) {
    const roleIds = idArray(body.roleIds).filter((id) => roles.some((r) => r.id === id));
    if (roleIds.length === 0) throw badRequest('At least one role is required');
    patch.roleIds = roleIds;
  }
  if (body.password) {
    if (str(body.password).length < 6) throw badRequest('Password must be at least 6 characters');
    patch.passwordHash = await bcrypt.hash(str(body.password), BCRYPT_ROUNDS);
  }

  const result = await collections.users.update(target.id, patch);
  await logAudit({
    user: req.user, action: 'update', entityType: 'user', entityId: target.id,
    entityLabel: result.after.username, details: 'User updated', changes: result
  });
  res.json(userWithRoles(result.after, roles, await collections.departments.all()));
}));

adminRouter.patch('/users/:id/status', requirePermission('users.edit'), asyncHandler(async (req, res) => {
  const target = await collections.users.getById(req.params.id);
  if (!target) throw notFound('User not found');
  const active = !!req.body?.active;
  if (!active && target.id === req.user.id) throw badRequest('You cannot deactivate your own account');
  if (!active && (await isLastAdmin(target.id))) throw badRequest('Cannot deactivate the last administrator');
  const result = await collections.users.update(target.id, { active });
  await logAudit({ user: req.user, action: active ? 'activate' : 'deactivate', entityType: 'user', entityId: target.id, entityLabel: target.username });
  res.json(userWithRoles(result.after, await collections.roles.all(), await collections.departments.all()));
}));

adminRouter.post('/users/:id/reset-password', requirePermission('users.edit'), asyncHandler(async (req, res) => {
  const target = await collections.users.getById(req.params.id);
  if (!target) throw notFound('User not found');
  const newPassword = str(req.body?.newPassword);
  if (newPassword.length < 6) throw badRequest('Password must be at least 6 characters');
  await collections.users.update(target.id, { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) });
  await logAudit({ user: req.user, action: 'password_reset', entityType: 'user', entityId: target.id, entityLabel: target.username, details: 'Password reset by administrator' });
  res.json({ ok: true });
}));

adminRouter.delete('/users/:id', requirePermission('users.delete'), asyncHandler(async (req, res) => {
  const target = await collections.users.getById(req.params.id);
  if (!target) throw notFound('User not found');
  if (target.id === req.user.id) throw badRequest('You cannot delete your own account');
  if (await isLastAdmin(target.id)) throw badRequest('Cannot delete the last administrator');

  // Unassign from tasks + steps so nothing points at a deleted person.
  await collections.tasks.transaction((rows) => {
    for (const task of rows) {
      if (task.assignedUserId === target.id) task.assignedUserId = null;
      for (const step of task.steps || []) {
        if (step.assignedUserId === target.id) step.assignedUserId = null;
      }
    }
  });
  await collections.users.remove(target.id);
  await logAudit({ user: req.user, action: 'delete', entityType: 'user', entityId: target.id, entityLabel: target.username, details: 'User deleted' });
  res.json({ ok: true });
}));

/** Tasks assigned to this user + their completion history. */
adminRouter.get('/users/:id/tasks', requirePermission('users.view'), asyncHandler(async (req, res) => {
  const target = await collections.users.getById(req.params.id);
  if (!target) throw notFound('User not found');
  const [tasks, projects] = await Promise.all([collections.tasks.all(), collections.projects.all()]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const simple = (t) => ({
    id: t.id, name: t.name, status: t.status, projectId: t.projectId,
    machineName: projectById.get(t.projectId)?.machineName || '',
    projectCode: projectById.get(t.projectId)?.code || '',
    plannedEnd: t.plannedEnd
  });
  const assigned = tasks.filter((t) => t.assignedUserId === target.id).map(simple);
  const history = [];
  for (const task of tasks) {
    for (const step of task.steps || []) {
      if (step.completedBy === target.id && step.completedAt) {
        history.push({
          stepId: step.id, stepTitle: step.title, taskName: task.name, taskId: task.id,
          machineName: projectById.get(task.projectId)?.machineName || '',
          completedAt: step.completedAt
        });
      }
    }
    if (task.assignedUserId === target.id && task.actualEnd) {
      history.push({ stepTitle: 'Task completed', taskName: task.name, taskId: task.id, machineName: projectById.get(task.projectId)?.machineName || '', completedAt: task.actualEnd });
    }
  }
  history.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  res.json({ assigned, history: history.slice(0, 200) });
}));

// ------------------------------------------------------------------ ROLES

adminRouter.get('/roles', requirePermission('roles.view', 'users.view'), asyncHandler(async (req, res) => {
  const [roles, users] = await Promise.all([collections.roles.all(), collections.users.all()]);
  const rows = roles.map((role) => ({
    ...role,
    userCount: users.filter((u) => (u.roleIds || []).includes(role.id)).length
  }));
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(rows);
}));

function validatePermissions(input) {
  const permissions = idArray(input);
  const unknown = permissions.filter((p) => p !== '*' && !ALL_PERMISSION_KEYS.includes(p));
  if (unknown.length > 0) throw badRequest(`Unknown permission(s): ${unknown.join(', ')}`);
  return permissions;
}

adminRouter.post('/roles', requirePermission('roles.create'), asyncHandler(async (req, res) => {
  const name = str(req.body?.name);
  if (!name) throw badRequest('Role name is required');
  const roles = await collections.roles.all();
  if (roles.some((r) => String(r.name).toLowerCase() === name.toLowerCase())) throw conflict(`Role "${name}" already exists`);
  const role = await collections.roles.insert({
    name,
    description: str(req.body?.description),
    permissions: validatePermissions(req.body?.permissions),
    active: req.body?.active !== false
  });
  await logAudit({ user: req.user, action: 'create', entityType: 'role', entityId: role.id, entityLabel: name, details: 'Role created' });
  res.status(201).json({ ...role, userCount: 0 });
}));

adminRouter.put('/roles/:id', requirePermission('roles.edit'), asyncHandler(async (req, res) => {
  const role = await collections.roles.getById(req.params.id);
  if (!role) throw notFound('Role not found');
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) throw badRequest('Role name cannot be empty');
    const roles = await collections.roles.all();
    if (roles.some((r) => r.id !== role.id && String(r.name).toLowerCase() === name.toLowerCase())) throw conflict(`Role "${name}" already exists`);
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = str(body.description);
  if (body.permissions !== undefined) patch.permissions = validatePermissions(body.permissions);
  if (body.active !== undefined) patch.active = !!body.active;
  if ((role.permissions || []).includes('*') && patch.permissions && !patch.permissions.includes('*')) {
    throw badRequest('The administrator role (*) must keep full permissions');
  }

  const result = await collections.roles.update(role.id, patch);
  await logAudit({ user: req.user, action: 'update', entityType: 'role', entityId: role.id, entityLabel: result.after.name, details: 'Role updated', changes: result });
  const users = await collections.users.all();
  res.json({ ...result.after, userCount: users.filter((u) => (u.roleIds || []).includes(role.id)).length });
}));

adminRouter.patch('/roles/:id/status', requirePermission('roles.edit'), asyncHandler(async (req, res) => {
  const role = await collections.roles.getById(req.params.id);
  if (!role) throw notFound('Role not found');
  const active = !!req.body?.active;
  if (!active && (role.permissions || []).includes('*')) throw badRequest('The administrator role cannot be deactivated');
  const result = await collections.roles.update(role.id, { active });
  await logAudit({ user: req.user, action: active ? 'activate' : 'deactivate', entityType: 'role', entityId: role.id, entityLabel: role.name });
  res.json(result.after);
}));

adminRouter.delete('/roles/:id', requirePermission('roles.delete'), asyncHandler(async (req, res) => {
  const role = await collections.roles.getById(req.params.id);
  if (!role) throw notFound('Role not found');
  if ((role.permissions || []).includes('*')) throw badRequest('The administrator role cannot be deleted');
  const users = await collections.users.all();
  const inUse = users.filter((u) => (u.roleIds || []).includes(role.id));
  if (inUse.length > 0) throw conflict(`This role is assigned to ${inUse.length} user(s). Reassign them first.`);
  await collections.roles.remove(role.id);
  await logAudit({ user: req.user, action: 'delete', entityType: 'role', entityId: role.id, entityLabel: role.name, details: 'Role deleted' });
  res.json({ ok: true });
}));

adminRouter.get('/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { PERMISSION_CATALOG } = await import('../constants.js');
  res.json(PERMISSION_CATALOG);
}));

// ------------------------------------------- simple config collections CRUD

function configRoutes({ path, collectionName, entityType, label, viewPermission, managePermission, referenceCheck }) {
  const router = Router();
  router.use(requireAuth);

  router.get(path, requirePermission(viewPermission), asyncHandler(async (req, res) => {
    const rows = await collections[collectionName].all();
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json(rows);
  }));

  router.post(path, requirePermission(managePermission), asyncHandler(async (req, res) => {
    const name = str(req.body?.name);
    if (!name) throw badRequest(`${label} name is required`);
    const rows = await collections[collectionName].all();
    if (rows.some((r) => String(r.name).toLowerCase() === name.toLowerCase())) throw conflict(`${label} "${name}" already exists`);
    const doc = await collections[collectionName].insert({
      name,
      code: str(req.body?.code || '').toUpperCase(),
      description: str(req.body?.description),
      active: req.body?.active !== false
    });
    await logAudit({ user: req.user, action: 'create', entityType, entityId: doc.id, entityLabel: name, details: `${label} created` });
    res.status(201).json(doc);
  }));

  router.put(`${path}/:id`, requirePermission(managePermission), asyncHandler(async (req, res) => {
    const doc = await collections[collectionName].getById(req.params.id);
    if (!doc) throw notFound(`${label} not found`);
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) throw badRequest('Name cannot be empty');
      const rows = await collections[collectionName].all();
      if (rows.some((r) => r.id !== doc.id && String(r.name).toLowerCase() === name.toLowerCase())) throw conflict(`${label} "${name}" already exists`);
      patch.name = name;
    }
    if (body.code !== undefined) patch.code = str(body.code).toUpperCase();
    if (body.description !== undefined) patch.description = str(body.description);
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.accept !== undefined) patch.accept = str(body.accept);
    if (body.kind !== undefined) patch.kind = str(body.kind);
    const result = await collections[collectionName].update(doc.id, patch);
    await logAudit({ user: req.user, action: 'update', entityType, entityId: doc.id, entityLabel: result.after.name, changes: result });
    res.json(result.after);
  }));

  router.delete(`${path}/:id`, requirePermission(managePermission), asyncHandler(async (req, res) => {
    const doc = await collections[collectionName].getById(req.params.id);
    if (!doc) throw notFound(`${label} not found`);
    if (referenceCheck) {
      const problem = await referenceCheck(doc);
      if (problem) throw conflict(problem);
    }
    await collections[collectionName].remove(doc.id);
    await logAudit({ user: req.user, action: 'delete', entityType, entityId: doc.id, entityLabel: doc.name, details: `${label} deleted` });
    res.json({ ok: true });
  }));

  return router;
}

async function referencedBy(field, collectionName, doc, message) {
  const rows = await collections[collectionName].all();
  return rows.some((r) => r[field] === doc.id) ? message : null;
}

async function evidenceTypeInUse(doc) {
  const [tasks, templates] = await Promise.all([collections.tasks.all(), collections.workflowTemplates.all()]);
  const usedInTasks = tasks.some((t) => (t.steps || []).some((s) => (s.evidenceTypes || []).includes(doc.key || doc.name)));
  const usedInTemplates = templates.some((t) => (t.tasks || []).some((task) => (task.steps || []).some((s) => (s.evidenceTypes || []).includes(doc.key || doc.name))));
  return usedInTasks || usedInTemplates
    ? 'This evidence type is used by tasks or templates. Deactivate it instead of deleting.'
    : null;
}

export const departmentsRouter = configRoutes({
  path: '/departments', collectionName: 'departments', entityType: 'department', label: 'Department',
  viewPermission: 'users.view', managePermission: 'config.manage',
  referenceCheck: async (doc) => {
    const byUser = await referencedBy('departmentId', 'users', doc, 'This department is assigned to people. Deactivate it instead of deleting.');
    if (byUser) return byUser;
    return referencedBy('departmentId', 'projects', doc, 'This department is used by projects. Deactivate it instead of deleting.');
  }
});

export const locationsRouter = configRoutes({
  path: '/locations', collectionName: 'locations', entityType: 'location', label: 'Location',
  viewPermission: 'projects.view', managePermission: 'config.manage',
  referenceCheck: (doc) => referencedBy('locationId', 'projects', doc, 'This location is used by projects. Deactivate it instead of deleting.')
});

export const projectTypesRouter = configRoutes({
  path: '/project-types', collectionName: 'projectTypes', entityType: 'projectType', label: 'Project type',
  viewPermission: 'projects.view', managePermission: 'config.manage',
  referenceCheck: async (doc) => {
    const byProjects = await referencedBy('projectTypeId', 'projects', doc, 'This project type is used by projects. Deactivate it instead of deleting.');
    if (byProjects) return byProjects;
    return referencedBy('projectTypeId', 'workflowTemplates', doc, 'This project type is used by workflow templates. Deactivate it instead of deleting.');
  }
});

export const evidenceTypesRouter = configRoutes({
  path: '/evidence-types', collectionName: 'evidenceTypes', entityType: 'evidenceType', label: 'Evidence type',
  viewPermission: 'workflow.view', managePermission: 'config.manage',
  referenceCheck: evidenceTypeInUse
});

// ------------------------------------------------------------------ SETTINGS

adminRouter.get('/settings', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  res.json({ ...DEFAULT_SETTINGS, ...(await readSettings()) });
}));

adminRouter.put('/settings', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.appName !== undefined) patch.appName = str(body.appName) || null;
  if (body.sequentialStepsDefault !== undefined) patch.sequentialStepsDefault = !!body.sequentialStepsDefault;
  if (body.requireEvidenceDefault !== undefined) patch.requireEvidenceDefault = !!body.requireEvidenceDefault;
  if (body.dueSoonHours !== undefined) patch.dueSoonHours = Number(body.dueSoonHours) || 48;
  if (body.demoData !== undefined) patch.demoData = !!body.demoData;
  const settings = await writeSettings(patch);
  await logAudit({ user: req.user, action: 'update', entityType: 'settings', entityId: 'settings', entityLabel: 'Application settings', changes: { after: patch } });
  res.json({ ...DEFAULT_SETTINGS, ...settings });
}));

// ------------------------------------------------------- STORAGE & BACKUPS

adminRouter.get('/admin/storage', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const [status, backups] = await Promise.all([dataFolderStatus(), listBackups()]);
  res.json({
    ...status,
    dataDir: config.dataDir,
    backupsDir: `${config.dataDir}\\backups`,
    storageDriver: 'shared-folder',
    lockStaleMs: config.lockStaleMs,
    maxUploadMb: Math.round(config.maxUploadBytes / (1024 * 1024)),
    backups
  });
}));

adminRouter.post('/admin/backups', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const result = await createBackup('manual');
  await logAudit({ user: req.user, action: 'backup', entityType: 'storage', entityId: 'backup', entityLabel: 'Manual backup', details: result.dir });
  res.json(result);
}));
