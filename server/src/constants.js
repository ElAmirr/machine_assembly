// Central catalogs + constants shared by validation, seeding and the UI (/api/meta).

export const PROJECT_STATUSES = [
  { key: 'planned', label: 'Planned' },
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'validation', label: 'Validation' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' }
];

export const TASK_STATUSES = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'submitted', label: 'Submitted for Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'completed', label: 'Completed' }
];

export const STEP_STATUSES = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'submitted', label: 'Submitted for Approval' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'completed', label: 'Completed' }
];

export const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'critical', label: 'Critical' }
];

export const DURATION_UNITS = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' },
  { key: 'days', label: 'Days' }
];

// Evidence types the admin can enable per step/workflow.
export const DEFAULT_EVIDENCE_TYPES = [
  { key: 'photo', label: 'Photo', kind: 'file', accept: 'image/*' },
  { key: 'video', label: 'Video', kind: 'file', accept: 'video/*' },
  { key: 'pdf', label: 'PDF Document', kind: 'file', accept: '.pdf' },
  { key: 'excel', label: 'Excel', kind: 'file', accept: '.xls,.xlsx,.csv' },
  { key: 'word', label: 'Word', kind: 'file', accept: '.doc,.docx' },
  { key: 'document', label: 'Document / File', kind: 'file', accept: '' },
  { key: 'measurement', label: 'Measurement', kind: 'measurement' },
  { key: 'comment', label: 'Comment', kind: 'comment' },
  { key: 'checklist', label: 'Checklist', kind: 'checklist' }
];

// Permission catalog (spec section 31). Admin role uses '*' for everything.
export const PERMISSION_CATALOG = [
  {
    group: 'People & Roles',
    permissions: [
      { key: 'users.view', label: 'View people' },
      { key: 'users.create', label: 'Add people' },
      { key: 'users.edit', label: 'Edit people' },
      { key: 'users.delete', label: 'Delete people' }
    ]
  },
  {
    group: 'Roles',
    permissions: [
      { key: 'roles.view', label: 'View roles' },
      { key: 'roles.create', label: 'Create roles' },
      { key: 'roles.edit', label: 'Edit roles' },
      { key: 'roles.delete', label: 'Delete roles' }
    ]
  },
  {
    group: 'Projects',
    permissions: [
      { key: 'projects.view', label: 'View projects' },
      { key: 'projects.create', label: 'Create projects' },
      { key: 'projects.edit', label: 'Edit projects' },
      { key: 'projects.delete', label: 'Delete projects' }
    ]
  },
  {
    group: 'Tasks & Steps',
    permissions: [
      { key: 'tasks.view', label: 'View tasks' },
      { key: 'tasks.create', label: 'Create tasks' },
      { key: 'tasks.edit', label: 'Edit tasks' },
      { key: 'tasks.complete', label: 'Work on / complete tasks' },
      { key: 'tasks.override', label: 'Override dependencies / restrictions' },
      { key: 'steps.view', label: 'View steps' },
      { key: 'steps.create', label: 'Create steps' },
      { key: 'steps.edit', label: 'Edit steps' },
      { key: 'steps.complete', label: 'Work on / complete steps' }
    ]
  },
  {
    group: 'Workflow Templates',
    permissions: [
      { key: 'workflow.view', label: 'View workflows' },
      { key: 'workflow.manage', label: 'Manage workflow templates' }
    ]
  },
  {
    group: 'Inventory',
    permissions: [
      { key: 'materials.view', label: 'View materials' },
      { key: 'materials.manage', label: 'Manage materials' },
      { key: 'components.view', label: 'View components' },
      { key: 'components.manage', label: 'Manage components' },
      { key: 'tools.view', label: 'View tools' },
      { key: 'tools.manage', label: 'Manage tools' }
    ]
  },
  {
    group: 'Files & Approval',
    permissions: [
      { key: 'attachments.view', label: 'View / download files' },
      { key: 'attachments.upload', label: 'Upload files & evidence' },
      { key: 'attachments.manage', label: 'Delete / replace any file' },
      { key: 'approvals.submit', label: 'Submit work for approval' },
      { key: 'approvals.approve', label: 'Approve / reject work' }
    ]
  },
  {
    group: 'Insights & Administration',
    permissions: [
      { key: 'reports.view', label: 'View reports / export' },
      { key: 'audit_logs.view', label: 'View audit history' },
      { key: 'config.manage', label: 'Manage departments, locations, types' },
      { key: 'settings.manage', label: 'Manage settings & backups' }
    ]
  }
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

export const ROLE_DEFAULT_PERMISSIONS = {
  Engineer: [
    'users.view', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.complete', 'tasks.override',
    'steps.view', 'steps.create', 'steps.edit', 'steps.complete',
    'workflow.view', 'workflow.manage',
    'materials.view', 'materials.manage', 'components.view', 'components.manage', 'tools.view', 'tools.manage',
    'attachments.view', 'attachments.upload', 'attachments.manage',
    'approvals.submit', 'approvals.approve', 'reports.view'
  ],
  Technician: [
    'projects.view', 'tasks.view', 'tasks.complete', 'steps.view', 'steps.complete',
    'workflow.view', 'materials.view', 'components.view', 'tools.view',
    'attachments.view', 'attachments.upload', 'approvals.submit'
  ]
};
ROLE_DEFAULT_PERMISSIONS['Electrical Technician'] = ROLE_DEFAULT_PERMISSIONS.Technician;
ROLE_DEFAULT_PERMISSIONS['Mechanical Technician'] = ROLE_DEFAULT_PERMISSIONS.Technician;

export const DEFAULT_SETTINGS = {
  appName: null, // take from config when null
  sequentialStepsDefault: true,
  requireEvidenceDefault: true,
  dueSoonHours: 48,
  demoData: false
};

// Map a file extension to an evidence/file category.
export function fileCategory(ext) {
  const e = String(ext || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic'].includes(e)) return 'photo';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(e)) return 'video';
  if (e === '.pdf') return 'pdf';
  if (['.xls', '.xlsx', '.csv'].includes(e)) return 'excel';
  if (['.doc', '.docx'].includes(e)) return 'word';
  return 'document';
}

// File types accepted for uploads (spec section 13).
export const ALLOWED_EXTENSIONS = [
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.ppt', '.pptx',
  '.dwg', '.dxf', '.step', '.stp', '.iges', '.igs', '.stl', '.zip', '.7z', '.rar',
  '.mp4', '.mov', '.avi', '.mkv', '.webm'
];
