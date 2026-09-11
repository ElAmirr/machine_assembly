// Shared "joins" so list endpoints can attach names (type, department, people, ...).
import { collections } from '../storage/db.js';

function byId(arr) {
  return new Map(arr.map((doc) => [doc.id, doc]));
}

export async function buildLookups() {
  const [roles, users, departments, locations, projectTypes, evidenceTypes, materials, components, tools] = await Promise.all([
    collections.roles.all(),
    collections.users.all(),
    collections.departments.all(),
    collections.locations.all(),
    collections.projectTypes.all(),
    collections.evidenceTypes.all(),
    collections.materials.all(),
    collections.components.all(),
    collections.tools.all()
  ]);

  const userById = byId(users);
  return {
    roles,
    users,
    departments,
    locations,
    projectTypes,
    evidenceTypes,
    materials,
    components,
    tools,
    roleById: byId(roles),
    userById,
    departmentById: byId(departments),
    locationById: byId(locations),
    projectTypeById: byId(projectTypes),
    evidenceTypeById: byId(evidenceTypes),
    materialById: byId(materials),
    componentById: byId(components),
    toolById: byId(tools),
    userName(userId) {
      const user = userById.get(userId);
      return user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username : null;
    }
  };
}
