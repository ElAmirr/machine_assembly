// In-app notifications (spec section 25). Architecture allows adding email later:
// every notification creation goes through here.
import { collections } from '../storage/db.js';
import { newId, nowIso } from '../utils.js';

/** Create one notification for each of the given users (single locked write). */
export async function notifyUsers(userIds, { type, title, message, link = null, entityType = null, entityId = null }, { excludeUserId = null } = {}) {
  const unique = [...new Set(userIds)].filter((id) => id && id !== excludeUserId);
  if (unique.length === 0) return;
  const createdAt = nowIso();
  await collections.notifications.transaction((rows) => {
    for (const userId of unique) {
      rows.push({
        id: newId('ntf'),
        userId,
        type,
        title,
        message,
        link,
        entityType,
        entityId,
        read: false,
        createdAt
      });
    }
  });
}

/** Notify every active user whose roles include the given permission. */
export async function notifyPermission(permissionKey, payload, options = {}) {
  const [users, roles] = await Promise.all([collections.users.all(), collections.roles.all()]);
  const roleIds = new Set(
    roles
      .filter((role) => role.active !== false && ((role.permissions || []).includes('*') || (role.permissions || []).includes(permissionKey)))
      .map((role) => role.id)
  );
  const userIds = users
    .filter((u) => u.active !== false && (u.roleIds || []).some((roleId) => roleIds.has(roleId)))
    .map((u) => u.id);
  await notifyUsers(userIds, payload, options);
}

/** Avoid duplicate notifications for the same entity within a time window (scheduler). */
export async function wasRecentlyNotified(userId, { type, entityId, withinHours = 24 }) {
  const threshold = Date.now() - withinHours * 60 * 60 * 1000;
  const rows = await collections.notifications.find({ userId, type, entityId });
  return rows.some((n) => new Date(n.createdAt).getTime() >= threshold);
}
