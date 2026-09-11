import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { collections, readSettings } from '../storage/db.js';
import { requireAuth, publicUser, userPermissions } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { asyncHandler, badRequest, unauthorized, str, pick, nowIso } from '../utils.js';
import {
  PROJECT_STATUSES, TASK_STATUSES, STEP_STATUSES, PRIORITIES, DURATION_UNITS,
  PERMISSION_CATALOG, ALLOWED_EXTENSIONS
} from '../constants.js';
import { MAX_UPLOAD_MB } from '../middleware/upload.js';
import { storageDriverName } from '../storage/blobStore.js';

export const authRouter = Router();

authRouter.post('/auth/login', asyncHandler(async (req, res) => {
  const username = str(req.body?.username).toLowerCase();
  const password = str(req.body?.password);
  if (!username || !password) throw badRequest('Username and password are required');

  const users = await collections.users.all();
  const user = users.find((u) => String(u.username).toLowerCase() === username);
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Invalid username or password');
  }
  if (user.active === false) throw unauthorized('This account is deactivated. Contact the administrator.');

  const roles = await collections.roles.all();
  const userRoles = roles.filter((r) => (user.roleIds || []).includes(r.id));
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: `${config.tokenHours}h` });

  const loginTime = nowIso();
  await collections.users.update(user.id, { lastLogin: loginTime });
  await logAudit({ user, action: 'login', entityType: 'user', entityId: user.id, entityLabel: user.username });

  res.json({
    token,
    user: publicUser({ ...user, lastLogin: loginTime }, roles),
    permissions: userPermissions(user, userRoles)
  });
}));

authRouter.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await logAudit({ user: req.user, action: 'logout', entityType: 'user', entityId: req.user.id, entityLabel: req.user.username });
  res.status(204).end();
}));

authRouter.get('/auth/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user, req.userRoles), permissions: req.permissions });
}));

authRouter.put('/auth/profile', requireAuth, asyncHandler(async (req, res) => {
  const patch = pick(req.body || {}, ['firstName', 'lastName', 'email', 'phone']);
  const result = await collections.users.update(req.user.id, patch);
  await logAudit({
    user: req.user, action: 'update', entityType: 'user', entityId: req.user.id,
    entityLabel: req.user.username, details: 'Updated own profile', changes: result
  });
  const roles = await collections.roles.all();
  res.json({ user: publicUser(result.after, roles) });
}));

authRouter.post('/auth/change-password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = str(req.body?.currentPassword);
  const newPassword = str(req.body?.newPassword);
  if (!currentPassword || !newPassword) throw badRequest('Current and new password are required');
  if (newPassword.length < 6) throw badRequest('New password must be at least 6 characters');
  const valid = await bcrypt.compare(currentPassword, req.user.passwordHash || '');
  if (!valid) throw unauthorized('Current password is incorrect');
  await collections.users.update(req.user.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
  await logAudit({ user: req.user, action: 'password_reset', entityType: 'user', entityId: req.user.id, entityLabel: req.user.username, details: 'Changed own password' });
  res.json({ ok: true });
}));

/** Catalogs used by the UI (statuses, units, evidence types, permissions...). */
authRouter.get('/meta', requireAuth, asyncHandler(async (req, res) => {
  const [settings, evidenceTypes, projectTypes] = await Promise.all([
    readSettings(),
    collections.evidenceTypes.all(),
    collections.projectTypes.all()
  ]);
  res.json({
    appName: settings.appName || config.appName,
    statuses: { project: PROJECT_STATUSES, task: TASK_STATUSES, step: STEP_STATUSES },
    priorities: PRIORITIES,
    durationUnits: DURATION_UNITS,
    permissionCatalog: PERMISSION_CATALOG,
    evidenceTypes: evidenceTypes.sort((a, b) => String(a.label).localeCompare(String(b.label))),
    projectTypes: projectTypes.filter((t) => t.active !== false),
    settings,
    maxUploadMb: MAX_UPLOAD_MB,
    allowedExtensions: ALLOWED_EXTENSIONS,
    dataDir: config.dataDir,
    storageDriver: storageDriverName
  });
}));

// Public health endpoint (used by the start script and to debug shared-folder access).
export const healthRouter = Router();
healthRouter.get('/health', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    appName: config.appName,
    dataDir: config.dataDir,
    storageDriver: storageDriverName,
    secretWarning: config.isDefaultSecret,
    at: nowIso()
  });
}));
