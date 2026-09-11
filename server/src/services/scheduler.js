// Background scan for deadline / overdue / delayed notifications (spec section 25).
import { collections } from '../storage/db.js';
import { notifyUsers, wasRecentlyNotified } from '../core/notify.js';

const HOUR = 60 * 60 * 1000;

async function scanOnce(logger = console) {
  try {
    const [tasks, projects] = await Promise.all([collections.tasks.all(), collections.projects.all()]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const now = Date.now();

    for (const task of tasks) {
      if (!task.assignedUserId) continue;
      if (['completed', 'approved', 'cancelled'].includes(task.status)) continue;
      if (!task.plannedEnd) continue;
      const end = new Date(task.plannedEnd).getTime();
      const project = projectById.get(task.projectId);
      const base = {
        link: `/tasks/${task.id}`,
        entityType: 'task',
        entityId: task.id
      };
      if (end < now) {
        if (!(await wasRecentlyNotified(task.assignedUserId, { type: 'task_overdue', entityId: task.id }))) {
          await notifyUsers([task.assignedUserId], {
            ...base,
            type: 'task_overdue',
            title: 'Task overdue',
            message: `"${task.name}" (${project?.machineName || ''}) is overdue since ${new Date(task.plannedEnd).toLocaleDateString()}.`
          });
        }
      } else if (end - now <= 48 * HOUR) {
        if (!(await wasRecentlyNotified(task.assignedUserId, { type: 'deadline_approaching', entityId: task.id }))) {
          await notifyUsers([task.assignedUserId], {
            ...base,
            type: 'deadline_approaching',
            title: 'Deadline approaching',
            message: `"${task.name}" (${project?.machineName || ''}) is due on ${new Date(task.plannedEnd).toLocaleDateString()}.`
          });
        }
      }
    }

    for (const project of projects) {
      if (!project.responsibleUserId) continue;
      if (['completed', 'cancelled'].includes(project.status)) continue;
      if (!project.plannedEndDate) continue;
      if (new Date(project.plannedEndDate).getTime() < now) {
        if (!(await wasRecentlyNotified(project.responsibleUserId, { type: 'project_delayed', entityId: project.id }))) {
          await notifyUsers([project.responsibleUserId], {
            type: 'project_delayed',
            title: 'Project delayed',
            message: `Project ${project.code} (${project.machineName}) passed its planned completion date.`,
            link: `/projects/${project.id}`,
            entityType: 'project',
            entityId: project.id
          });
        }
      }
    }
  } catch (err) {
    logger.error('[scheduler] scan failed:', err.message);
  }
}

export function startScheduler(logger = console) {
  scanOnce(logger);
  const timer = setInterval(() => scanOnce(logger), HOUR);
  timer.unref?.();
}
