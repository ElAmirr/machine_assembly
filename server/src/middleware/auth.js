// Authentication + permission middleware. The backend ALWAYS enforces
// permissions (spec section 45: never trust frontend permissions alone).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { collections } from '../storage/db.js';
import { ApiError, unauthorized, forbidden } from '../utils.js';

/** Union of permissions of all active roles of a user. '*' means everything. */
export function userPermissions(user, roles) {
  const perms = new Set();
  for (const role of roles) {
    if (role.active === false) continue;
    for (const p of role.permissions || []) perms.add(p);
  }
  if (perms.has('*')) return ['*'];
  return [...perms];
}

export function publicUser(user, roles = []) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    roles: roles.filter((r) => (user.roleIds || []).includes(r.id)).map((r) => ({ id: r.id, name: r.name }))
  };
}

/** Require a valid JWT + load the fresh user (deactivation takes effect immediately). */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    // The ?token= query form exists for <img>/<a> downloads that cannot send headers.
    const token = header.startsWith('Bearer ') ? header.slice(7) : (typeof req.query?.token === 'string' ? req.query.token : null);
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Session expired, please log in again');
    }

    const [user, roles] = await Promise.all([collections.users.getById(payload.sub), collections.roles.all()]);
    if (!user || user.active === false) throw unauthorized('This account is inactive or no longer exists');

    req.user = user;
    req.userRoles = roles.filter((r) => (user.roleIds || []).includes(r.id));
    req.permissions = userPermissions(user, req.userRoles);
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard: user needs at least one of the given permission keys ('*' allows all). */
export function requirePermission(...keys) {
  return (req, res, next) => {
    const perms = req.permissions || [];
    const allowed = perms.includes('*') || keys.some((key) => perms.includes(key));
    if (!allowed) {
      return next(forbidden(`You do not have permission (${keys.join(' or ')})`));
    }
    next();
  };
}

export function hasPermission(user, permissions, key) {
  if (!permissions) return false;
  return permissions.includes('*') || permissions.includes(key);
}

/** True when the user can act on a task they are not assigned to (editors/overriders). */
export function canActOnTask(req, task) {
  const perms = req.permissions || [];
  if (perms.includes('*') || perms.includes('tasks.edit') || perms.includes('tasks.override')) return true;
  return task.assignedUserId === req.user.id;
}

export { ApiError };
