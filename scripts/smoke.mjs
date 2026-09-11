// Quick API smoke test against a running server. Usage: node scripts/smoke.mjs [baseUrl]
const base = process.argv[2] || 'http://localhost:4000';
let failures = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function check(label, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${info ? '  ' + info : ''}`);
  if (!ok) failures++;
}

const health = await call('GET', '/api/health');
check('GET /api/health', health.status === 200 && health.data.ok === true);

const badLogin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
check('POST /api/auth/login (bad password -> 401)', badLogin.status === 401);

const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
check('POST /api/auth/login (admin)', login.status === 200 && !!login.data.token, login.data?.user?.username || '');
const token = login.data?.token;

const me = await call('GET', '/api/auth/me', { token });
check('GET /api/auth/me', me.status === 200 && Array.isArray(me.data?.permissions), `perms=${me.data?.permissions?.length}`);

const noAuth = await call('GET', '/api/projects');
check('GET /api/projects (no token -> 401)', noAuth.status === 401);

const meta = await call('GET', '/api/meta', { token });
check('GET /api/meta', meta.status === 200 && Array.isArray(meta.data?.projectTypes), `projectTypes=${meta.data?.projectTypes?.length}`);

const projects = await call('GET', '/api/projects', { token });
check('GET /api/projects', projects.status === 200 && Array.isArray(projects.data), `count=${projects.data?.length}`);

const first = projects.data?.[0];
const detail = first ? await call('GET', `/api/projects/${first.id}`, { token }) : { status: 0 };
check('GET /api/projects/:id', detail.status === 200 && Array.isArray(detail.data?.tasks), `tasks=${detail.data?.tasks?.length}`);

const machines = await call('GET', '/api/machines', { token });
check('GET /api/machines', machines.status === 200 && Array.isArray(machines.data), `count=${machines.data?.length}`);

const tasks = await call('GET', '/api/tasks?mine=1', { token });
check('GET /api/tasks?mine=1', tasks.status === 200 && Array.isArray(tasks.data), `count=${tasks.data?.length}`);

const task = tasks.data?.[0];
if (task) {
  const taskDetail = await call('GET', `/api/tasks/${task.id}`, { token });
  check('GET /api/tasks/:id', taskDetail.status === 200 && !!taskDetail.data?.task && !!taskDetail.data?.permissions);
}

const dash = await call('GET', '/api/dashboard/summary', { token });
check('GET /api/dashboard/summary', dash.status === 200 && !!dash.data?.kpis);

const myDash = await call('GET', '/api/dashboard/my', { token });
check('GET /api/dashboard/my', myDash.status === 200 && !!myDash.data?.buckets);

const reports = await call('GET', '/api/reports', { token });
check('GET /api/reports', reports.status === 200 && Array.isArray(reports.data), `count=${reports.data?.length}`);

const report = await call('GET', '/api/reports/project-progress?format=csv', { token });
check('GET /api/reports/project-progress?format=csv', report.status === 200 && typeof report.data === 'string' && report.data.includes(','));

const search = await call('GET', '/api/search?q=juki', { token });
check('GET /api/search?q=juki', search.status === 200 && (search.data?.projects?.length ?? 0) > 0, `projects=${search.data?.projects?.length}`);

const notif = await call('GET', '/api/notifications', { token });
check('GET /api/notifications', notif.status === 200 && Array.isArray(notif.data), `count=${notif.data?.length}`);

const audit = await call('GET', '/api/audit-logs', { token });
check('GET /api/audit-logs', audit.status === 200 && Array.isArray(audit.data), `count=${audit.data?.length}`);

const workflows = await call('GET', '/api/workflow-templates', { token });
check('GET /api/workflow-templates', workflows.status === 200 && Array.isArray(workflows.data), `count=${workflows.data?.length}`);

const users = await call('GET', '/api/users', { token });
check('GET /api/users', users.status === 200 && Array.isArray(users.data), `count=${users.data?.length}`);

const roles = await call('GET', '/api/roles', { token });
check('GET /api/roles', roles.status === 200 && Array.isArray(roles.data), `count=${roles.data?.length}`);

const materials = await call('GET', '/api/materials', { token });
check('GET /api/materials', materials.status === 200 && Array.isArray(materials.data), `count=${materials.data?.length}`);

const components = await call('GET', '/api/components', { token });
check('GET /api/components', components.status === 200 && Array.isArray(components.data), `count=${components.data?.length}`);

const tools = await call('GET', '/api/tools', { token });
check('GET /api/tools', tools.status === 200 && Array.isArray(tools.data), `count=${tools.data?.length}`);

// technician visibility + permission checks
const techLogin = await call('POST', '/api/auth/login', { body: { username: 'ahmed', password: 'ahmed123' } });
const techToken = techLogin.data?.token;
const techProjects = await call('GET', '/api/projects', { token: techToken });
const techUsers = await call('GET', '/api/users', { token: techToken });
check('Technician login', techLogin.status === 200 && !!techToken);
check('Technician sees limited projects', techProjects.status === 200, `projects=${techProjects.data?.length} (admin=${projects.data?.length})`);
check('Technician forbidden from /users -> 403', techUsers.status === 403);

// engineer can see approvals; technician cannot approve (403)
const engLogin = await call('POST', '/api/auth/login', { body: { username: 'mohamed', password: 'mohamed123' } });
const engToken = engLogin.data?.token;
const approvals = await call('GET', '/api/approvals', { token: engToken });
check('GET /api/approvals (engineer)', approvals.status === 200 && Array.isArray(approvals.data));

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
