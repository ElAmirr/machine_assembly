// Complete audit trail (spec section 26): who did what, when, with before/after.
import { collections } from '../storage/db.js';
import { newId, nowIso } from '../utils.js';

/**
 * Append an audit entry. Never throws - auditing must not break the main action.
 * action: create | update | delete | login | start | complete | submit | approve | reject | upload | upload_evidence | status | password_reset | seed | backup ...
 */
export async function logAudit({ user, action, entityType, entityId = null, entityLabel = '', details = null, changes = null }) {
  try {
    await collections.auditLogs.insert({
      id: newId('audit'),
      at: nowIso(),
      userId: user?.id || null,
      userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username : 'system',
      action,
      entityType,
      entityId,
      entityLabel,
      details,
      changes: changes ? { before: pickChanges(changes.before), after: pickChanges(changes.after) } : null
    });
  } catch (err) {
    console.error('[audit] failed to write entry:', err.message);
  }
}

function pickChanges(doc) {
  if (!doc) return null;
  const clone = { ...doc };
  delete clone.passwordHash; // never store password hashes in the audit trail
  return clone;
}
