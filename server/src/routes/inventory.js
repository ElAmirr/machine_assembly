// Inventory module: materials (spec 16), components (spec 17), tools (spec 18).
import { Router } from 'express';
import { collections } from '../storage/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../core/audit.js';
import { asyncHandler, badRequest, conflict, notFound, str, toNum } from '../utils.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const KINDS = {
  materials: {
    path: '/materials',
    label: 'Material',
    entityType: 'material',
    viewPermission: 'materials.view',
    managePermission: 'materials.manage',
    numericFields: []
  },
  components: {
    path: '/components',
    label: 'Component',
    entityType: 'component',
    viewPermission: 'components.view',
    managePermission: 'components.manage',
    numericFields: ['quantity']
  },
  tools: {
    path: '/tools',
    label: 'Tool',
    entityType: 'tool',
    viewPermission: 'tools.view',
    managePermission: 'tools.manage',
    numericFields: ['quantity']
  }
};

function normString(body, key) {
  return str(body?.[key]);
}

// ------------------------------------------------------------ read

for (const kind of Object.values(KINDS)) {
  inventoryRouter.get(kind.path, requirePermission(kind.viewPermission), asyncHandler(async (req, res) => {
    let rows = await collections[kind.entityType === 'material' ? 'materials' : kind.entityType === 'component' ? 'components' : 'tools'].all();
    const term = str(req.query.q).toLowerCase();
    if (req.query.status) rows = rows.filter((r) => (r.status || 'active') === str(req.query.status));
    if (term) {
      rows = rows.filter((r) =>
        [r.name, r.reference, r.partNumber, r.manufacturer, r.supplier, r.location, r.description]
          .some((v) => String(v || '').toLowerCase().includes(term))
      );
    }
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json(rows);
  }));

  inventoryRouter.get(`${kind.path}/:id`, requirePermission(kind.viewPermission), asyncHandler(async (req, res) => {
    const collection = collections[kind.entityType === 'material' ? 'materials' : kind.entityType === 'component' ? 'components' : 'tools'];
    const doc = await collection.getById(req.params.id);
    if (!doc) throw notFound(`${kind.label} not found`);
    res.json(doc);
  }));
}

// ------------------------------------------------------------ create / update / delete

function collectionOf(kind) {
  return collections[kind.entityType === 'material' ? 'materials' : kind.entityType === 'component' ? 'components' : 'tools'];
}

function buildPatch(kind, body) {
  const patch = {};
  const text = ['name', 'reference', 'description', 'supplier', 'location', 'unit', 'partNumber', 'manufacturer'];
  for (const key of text) if (body[key] !== undefined) patch[key] = normString(body, key);
  for (const key of kind.numericFields) if (body[key] !== undefined) patch[key] = toNum(body[key], null);
  if (body.status !== undefined) patch.status = str(body.status) || 'active';
  return patch;
}

for (const kind of Object.values(KINDS)) {
  inventoryRouter.post(kind.path, requirePermission(kind.managePermission), asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = str(body.name);
    if (!name) throw badRequest(`${kind.label} name is required`);
    const collection = collectionOf(kind);
    const rows = await collection.all();
    if (rows.some((r) => String(r.name).toLowerCase() === name.toLowerCase())) {
      throw conflict(`${kind.label} "${name}" already exists`);
    }
    const doc = await collection.insert({
      ...buildPatch(kind, body),
      name,
      status: str(body.status) || (kind.entityType === 'tool' ? 'available' : 'active')
    });
    await logAudit({ user: req.user, action: 'create', entityType: kind.entityType, entityId: doc.id, entityLabel: name, details: `${kind.label} created` });
    res.status(201).json(doc);
  }));

  inventoryRouter.put(`${kind.path}/:id`, requirePermission(kind.managePermission), asyncHandler(async (req, res) => {
    const collection = collectionOf(kind);
    const doc = await collection.getById(req.params.id);
    if (!doc) throw notFound(`${kind.label} not found`);
    const body = req.body || {};
    const patch = buildPatch(kind, body);
    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) throw badRequest('Name cannot be empty');
      const rows = await collection.all();
      if (rows.some((r) => r.id !== doc.id && String(r.name).toLowerCase() === name.toLowerCase())) {
        throw conflict(`${kind.label} "${name}" already exists`);
      }
      patch.name = name;
    }
    const result = await collection.update(doc.id, patch);
    await logAudit({ user: req.user, action: 'update', entityType: kind.entityType, entityId: doc.id, entityLabel: result.after.name, changes: result });
    res.json(result.after);
  }));

  inventoryRouter.delete(`${kind.path}/:id`, requirePermission(kind.managePermission), asyncHandler(async (req, res) => {
    const collection = collectionOf(kind);
    const doc = await collection.getById(req.params.id);
    if (!doc) throw notFound(`${kind.label} not found`);

    // Refuse to delete while referenced by tasks, templates or projects.
    const idKey = kind.entityType === 'material' ? 'materialId' : kind.entityType === 'component' ? 'componentId' : 'toolId';
    const [tasks, templates] = await Promise.all([collections.tasks.all(), collections.workflowTemplates.all()]);
    const inTasks = tasks.some((t) => (t[idKey === 'materialId' ? 'materials' : idKey === 'componentId' ? 'components' : 'tools'] || []).some((r) => r[idKey] === doc.id)
      || (t.steps || []).some((s) => (s[idKey === 'materialId' ? 'materials' : idKey === 'componentId' ? 'components' : 'tools'] || []).some((r) => r[idKey] === doc.id)));
    const inTemplates = templates.some((t) => (t.tasks || []).some((task) => (task.materials || []).some((r) => r[idKey] === doc.id)
      || (task.steps || []).some((s) => (s[idKey === 'materialId' ? 'materials' : idKey === 'componentId' ? 'components' : 'tools'] || []).some((r) => r[idKey] === doc.id))));
    if (inTasks || inTemplates) {
      throw conflict(`This ${kind.label.toLowerCase()} is referenced by tasks or workflow templates. Set its status to inactive instead of deleting.`);
    }

    await collection.remove(doc.id);
    await logAudit({ user: req.user, action: 'delete', entityType: kind.entityType, entityId: doc.id, entityLabel: doc.name, details: `${kind.label} deleted` });
    res.json({ ok: true });
  }));
}
