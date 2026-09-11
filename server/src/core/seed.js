// Demo/initial data (spec sections 41, 46). Runs automatically on first start,
// and can be re-run with: npm run seed -- --force
import bcrypt from 'bcryptjs';
import { collections, singletons, resetAllFiles } from '../storage/db.js';
import { ROLE_DEFAULT_PERMISSIONS, DEFAULT_EVIDENCE_TYPES } from '../constants.js';
import { createProject, syncProjectProgress } from '../services/projectService.js';
import { logAudit } from './audit.js';
import { newId, nowIso } from '../utils.js';

const day = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * day).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * day).toISOString();

export async function seedIfEmpty(logger = console) {
  const users = await collections.users.all();
  if (users.length > 0) return false;
  logger.log('[seed] No users found - creating demo data (spec section 46)...');
  await seedNow({ force: false, logger });
  return true;
}

export async function seedNow({ force = false, logger = console } = {}) {
  if (force) {
    await resetAllFiles();
  } else {
    const users = await collections.users.all();
    if (users.length > 0) {
      logger.log('[seed] Data already exists. Use "npm run seed -- --force" to reset and reseed.');
      return false;
    }
  }

  // ---------------------------------------------------------------- roles
  const roleDefs = [
    { name: 'Admin', description: 'Full access to everything', permissions: ['*'] },
    { name: 'Engineer', description: 'Design, planning, validation and approvals', permissions: ROLE_DEFAULT_PERMISSIONS.Engineer },
    { name: 'Technician', description: 'Executes assembly / refurbishment work', permissions: ROLE_DEFAULT_PERMISSIONS.Technician },
    { name: 'Electrical Technician', description: 'Electrical cabinet, wiring and tests', permissions: ROLE_DEFAULT_PERMISSIONS['Electrical Technician'] },
    { name: 'Mechanical Technician', description: 'Mechanical adjustments and assembly', permissions: ROLE_DEFAULT_PERMISSIONS['Mechanical Technician'] }
  ];
  const roles = {};
  for (const def of roleDefs) {
    const role = await collections.roles.insert({ id: newId('role'), ...def, active: true });
    roles[def.name] = role;
  }

  // ---------------------------------------------------------------- config collections
  const departmentDefs = [
    ['Production', 'Production department'],
    ['Maintenance', 'Machine maintenance team'],
    ['Engineering', 'Industrial engineering'],
    ['Quality', 'Quality assurance'],
    ['Electrical', 'Electrical / automation team']
  ];
  const departments = {};
  for (const [name, description] of departmentDefs) {
    const doc = await collections.departments.insert({ id: newId('dept'), name, description, active: true });
    departments[name] = doc;
  }

  const locationDefs = ['Plant 1 - Assembly Hall', 'Plant 1 - Line 1', 'Plant 1 - Line 2', 'Workshop A', 'Spare Parts Storage'];
  const locations = {};
  for (const name of locationDefs) {
    const doc = await collections.locations.insert({ id: newId('loc'), name, description: '', active: true });
    locations[name] = doc;
  }

  const typeDefs = [
    ['REPLACEMENT', 'Machine Replacement', 'Replace an existing machine with a new one'],
    ['ASSEMBLY', 'Machine Assembly', 'Assemble a new machine / workstation'],
    ['REFURBISHMENT', 'Machine Refurbishment', 'Refurbish and upgrade an existing machine']
  ];
  const projectTypes = {};
  for (const [code, name, description] of typeDefs) {
    const doc = await collections.projectTypes.insert({ id: newId('ptype'), code, name, description, active: true });
    projectTypes[code] = doc;
  }

  for (const evidenceType of DEFAULT_EVIDENCE_TYPES) {
    await collections.evidenceTypes.insert({ id: newId('evt'), ...evidenceType, active: true });
  }

  // ---------------------------------------------------------------- people
  const userDefs = [
    { firstName: 'Admin', lastName: 'User', username: 'admin', password: 'admin123', role: 'Admin', department: 'Engineering' },
    { firstName: 'Ahmed', lastName: 'Technician', username: 'ahmed', password: 'ahmed123', role: 'Technician', department: 'Production' },
    { firstName: 'Mohamed', lastName: 'Engineer', username: 'mohamed', password: 'mohamed123', role: 'Engineer', department: 'Engineering' },
    { firstName: 'Karim', lastName: 'Electro', username: 'karim', password: 'karim123', role: 'Electrical Technician', department: 'Electrical' },
    { firstName: 'Slim', lastName: 'Mecanique', username: 'slim', password: 'slim123', role: 'Mechanical Technician', department: 'Maintenance' }
  ];
  const users = {};
  for (const def of userDefs) {
    const user = await collections.users.insert({
      id: newId('user'),
      firstName: def.firstName,
      lastName: def.lastName,
      username: def.username,
      email: `${def.username}@factory.local`,
      phone: '',
      roleIds: [roles[def.role].id],
      departmentId: departments[def.department]?.id || null,
      passwordHash: bcrypt.hashSync(def.password, 10),
      active: true,
      lastLogin: null
    });
    users[def.username] = user;
  }

  // ---------------------------------------------------------------- inventory
  const materialDefs = [
    { name: 'Electrical Cable 2.5mm2', reference: 'MAT-CBL-25', unit: 'm', supplier: 'ElectroParts', stockQuantity: 250, minStock: 50, location: 'Spare Parts Storage' },
    { name: 'Screws M4x20', reference: 'MAT-SCR-M4', unit: 'pcs', supplier: 'FastFix', stockQuantity: 1000, minStock: 200, location: 'Spare Parts Storage' },
    { name: 'Cable Ties', reference: 'MAT-TIE-200', unit: 'pcs', supplier: 'ElectroParts', stockQuantity: 500, minStock: 100, location: 'Spare Parts Storage' },
    { name: 'Cable Glands M16', reference: 'MAT-GLD-M16', unit: 'pcs', supplier: 'ElectroParts', stockQuantity: 120, minStock: 30, location: 'Spare Parts Storage' },
    { name: 'Heat Shrink Tube', reference: 'MAT-HST-10', unit: 'm', supplier: 'ElectroParts', stockQuantity: 80, minStock: 20, location: 'Spare Parts Storage' },
    { name: 'Thread Locking Compound', reference: 'MAT-TLC-01', unit: 'bottle', supplier: 'LoctitePro', stockQuantity: 12, minStock: 4, location: 'Workshop A' },
    { name: 'Lubricant Grease', reference: 'MAT-GRS-01', unit: 'kg', supplier: 'MachineOil', stockQuantity: 15, minStock: 5, location: 'Workshop A' },
    { name: 'Sensor Bracket', reference: 'MAT-BRK-SEN', unit: 'pcs', supplier: 'MechParts', stockQuantity: 40, minStock: 10, location: 'Storage B' }
  ];
  const materials = {};
  for (const def of materialDefs) {
    const doc = await collections.materials.insert({ id: newId('mat'), description: '', status: 'active', price: null, ...def });
    materials[def.name] = doc;
  }

  const componentDefs = [
    { name: 'Proximity Sensor', reference: 'PS-001', partNumber: 'PS-001', manufacturer: 'Keyence', quantity: 25, supplier: 'AutomationPro', location: 'Storage B' },
    { name: 'PLC Module CPU1215C', reference: 'PLC-CPU1215', partNumber: '6ES7215-1AG40', manufacturer: 'Siemens', quantity: 6, supplier: 'AutomationPro', location: 'Storage B' },
    { name: 'Contactor 24V', reference: 'CTR-LC1D09', partNumber: 'LC1D09', manufacturer: 'Schneider', quantity: 18, supplier: 'ElectroParts', location: 'Storage B' },
    { name: 'Relay 24V DC', reference: 'RLY-RXM2AB2', partNumber: 'RXM2AB2BD', manufacturer: 'Schneider', quantity: 30, supplier: 'ElectroParts', location: 'Storage B' },
    { name: 'HMI Panel 7 inch', reference: 'HMI-KTP700', partNumber: 'KTP700', manufacturer: 'Siemens', quantity: 4, supplier: 'AutomationPro', location: 'Storage B' },
    { name: 'Emergency Stop Switch', reference: 'ES-44', partNumber: 'XB4BS8442', manufacturer: 'Schneider', quantity: 22, supplier: 'ElectroParts', location: 'Storage B' }
  ];
  const components = {};
  for (const def of componentDefs) {
    const doc = await collections.components.insert({ id: newId('cmp'), description: '', status: 'active', ...def });
    components[def.name] = doc;
  }

  const toolDefs = [
    { name: 'Torque Wrench', reference: 'T-001', quantity: 1 },
    { name: 'Multimeter', reference: 'T-002', quantity: 3 },
    { name: 'Barcode Scanner', reference: 'T-003', quantity: 2 },
    { name: 'Drill', reference: 'T-004', quantity: 2 },
    { name: 'Laptop', reference: 'T-005', quantity: 3 },
    { name: 'PLC Programming Cable', reference: 'T-006', quantity: 2 },
    { name: 'Digital Caliper', reference: 'T-007', quantity: 4 },
    { name: 'Soldering Iron', reference: 'T-008', quantity: 2 }
  ];
  const tools = {};
  for (const def of toolDefs) {
    const doc = await collections.tools.insert({ id: newId('tool'), description: '', status: 'available', location: 'Workshop A', ...def });
    tools[def.name] = doc;
  }

  // ---------------------------------------------------------------- workflow templates
  const step = (title, opts = {}) => ({
    id: newId('wts'),
    order: 0,
    title,
    description: opts.description || '',
    instructions: opts.instructions || '',
    estimatedDuration: opts.duration ?? 0,
    durationUnit: opts.unit || 'days',
    roleId: null,
    assignedUserId: null,
    materials: opts.materials || [],
    components: opts.components || [],
    tools: opts.tools || [],
    evidenceRequired: opts.evidenceRequired ?? false,
    evidenceTypes: opts.evidenceTypes || [],
    minFiles: opts.minFiles ?? 1,
    maxFiles: opts.maxFiles ?? null,
    measurement: opts.measurement || { enabled: false, name: '', expected: null, tolerance: 0, unit: '', required: true },
    approvalRequired: opts.approvalRequired ?? false,
    notes: ''
  });
  const req = {
    material: (name, quantity, unit, notes = '') => ({ materialId: materials[name]?.id, quantity, unit: unit || materials[name]?.unit || '', notes }),
    component: (name, quantity, notes = '') => ({ componentId: components[name]?.id, quantity, notes }),
    tool: (name, notes = '') => ({ toolId: tools[name]?.id, quantity: 1, unit: '', notes })
  };

  const pokaYokeFullSteps = [
    step('Read Poka-Yoke instruction', {
      description: 'Read the work instruction and understand the required validation sequence.',
      instructions: '1. Open the attached work instruction PDF.\n2. Identify the detection points.\n3. Confirm you understand the OK/NOK sequence before touching the machine.'
    }),
    step('Prepare required components', {
      description: 'Collect the sensors and accessories required for the Poka-Yoke installation.',
      components: [req.component('Proximity Sensor', 2)],
      materials: [req.material('Cable Ties', 20, 'pcs')]
    }),
    step('Install sensors', {
      description: 'Install the sensor according to the technical drawing.',
      instructions: 'Adjust the sensor distance to 5 mm from the target. Use the bracket to lock the position.',
      components: [req.component('Proximity Sensor', 2), req.component('Sensor Bracket', 2)],
      materials: [req.material('Screws M4x20', 8, 'pcs'), req.material('Cable Ties', 10, 'pcs')],
      tools: [req.tool('Digital Caliper'), req.tool('Drill')],
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 1,
      maxFiles: 5,
      measurement: { enabled: true, name: 'Sensor distance', expected: 5, tolerance: 0.5, unit: 'mm', required: true }
    }),
    step('Connect electrical system', {
      description: 'Wire the sensors and connect them to the machine control system.',
      materials: [req.material('Electrical Cable 2.5mm2', 6, 'm'), req.material('Cable Glands M16', 2, 'pcs')],
      tools: [req.tool('Multimeter')],
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 1
    }),
    step('Perform validation test', {
      description: 'Perform the validation sequence and confirm that the machine cannot start when a wrong component is detected.',
      instructions: 'Test with a wrong component 3 times. The machine must refuse to start every time.',
      tools: [req.tool('Barcode Scanner')],
      evidenceRequired: true,
      evidenceTypes: ['photo', 'video'],
      minFiles: 1
    }),
    step('Upload proof photos', {
      description: 'Take clear photos of the installed sensors and the validated sequence.',
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 2,
      maxFiles: 5
    }),
    step('Submit for validation', {
      description: 'Submit the task for engineer validation once everything is complete.'
    })
  ];

  const pokaYokeShortSteps = [
    step('Read Poka-Yoke instruction', { description: 'Read the work instruction and understand the required sequence.' }),
    step('Prepare required components', {
      components: [req.component('Proximity Sensor', 2)],
      materials: [req.material('Cable Ties', 20, 'pcs')]
    }),
    step('Install sensor and connect', {
      components: [req.component('Proximity Sensor', 2)],
      materials: [req.material('Electrical Cable 2.5mm2', 5, 'm')],
      tools: [req.tool('Multimeter')],
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 1,
      measurement: { enabled: true, name: 'Sensor distance', expected: 5, tolerance: 0.5, unit: 'mm', required: true }
    }),
    step('Validate system', {
      description: 'Perform the validation sequence and confirm the wrong component is detected.',
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 1
    })
  ];

  const validationSteps = [
    step('Run validation checklist', {
      description: 'Perform the complete machine validation according to the checklist.',
      evidenceRequired: true,
      evidenceTypes: ['photo'],
      minFiles: 1
    }),
    step('Sign-off documentation', {
      description: 'Upload the signed validation report.',
      evidenceRequired: true,
      evidenceTypes: ['pdf'],
      minFiles: 1
    })
  ];

  function buildTask(name, roleName, duration, unit, extra = {}) {
    return {
      id: newId('wtt'),
      order: 0,
      name,
      description: extra.description || '',
      roleId: roles[roleName]?.id || null,
      assignedUserId: null,
      estimatedDuration: duration,
      durationUnit: unit,
      approvalRequired: extra.approvalRequired || false,
      sequentialSteps: extra.sequentialSteps !== false,
      dependsOn: [],
      materials: extra.materials || [],
      components: extra.components || [],
      tools: extra.tools || [],
      notes: '',
      steps: extra.steps || []
    };
  }

  function linkDeps(tasks, index, depIndexes) {
    tasks[index].dependsOn = depIndexes.map((i) => tasks[i].id);
  }

  const replacementTasks = [
    buildTask('Receiving Machine', 'Technician', 1, 'days', {
      description: 'Receive the new machine and check its condition.',
      steps: [
        step('Check delivery and packing', { description: 'Check for transport damage and complete packing list.' }),
        step('Register machine serial number', { description: 'Register the serial number and store the machine in Workshop A.' })
      ]
    }),
    buildTask('Design Jigs and Table', 'Engineer', 3, 'days', {
      steps: [
        step('Collect requirements from production', { description: 'Collect dimensions, cycle time and operator requirements.' }),
        step('Create 3D design of jigs and table', {
          evidenceRequired: true, evidenceTypes: ['pdf', 'document'], minFiles: 1,
          description: 'Create the 3D design and export the drawing as PDF.'
        }),
        step('Review design with production team', { evidenceRequired: true, evidenceTypes: ['comment'], minFiles: 1 })
      ]
    }),
    buildTask('Order Jigs and Table', 'Engineer', 5, 'days', {
      steps: [
        step('Send order to supplier', { tools: [req.tool('Laptop')] }),
        step('Track delivery and reception', { materials: [req.material('Screws M4x20', 50, 'pcs')] })
      ]
    }),
    buildTask('Electrical Cabinet', 'Electrical Technician', 4, 'days', {
      components: [req.component('PLC Module CPU1215C', 1), req.component('Contactor 24V', 2), req.component('Relay 24V DC', 4), req.component('Emergency Stop Switch', 1)],
      materials: [req.material('Electrical Cable 2.5mm2', 25, 'm'), req.material('Cable Glands M16', 6, 'pcs')],
      tools: [req.tool('Multimeter'), req.tool('Laptop'), req.tool('PLC Programming Cable')],
      steps: [
        step('Prepare cabinet and components', {}),
        step('Wiring and cabinet assembly', {
          evidenceRequired: true, evidenceTypes: ['photo'], minFiles: 1, maxFiles: 5
        }),
        step('Electrical test', {
          evidenceRequired: true, evidenceTypes: ['pdf', 'measurement'], minFiles: 1,
          measurement: { enabled: true, name: 'Supply voltage', expected: 24, tolerance: 1, unit: 'V', required: true }
        })
      ]
    }),
    buildTask('Table and Jigs Assembly', 'Technician', 2, 'days', {
      materials: [req.material('Screws M4x20', 30, 'pcs'), req.material('Thread Locking Compound', 1, 'bottle')],
      tools: [req.tool('Torque Wrench'), req.tool('Drill'), req.tool('Digital Caliper')],
      steps: [
        step('Mount table frame', {}),
        step('Install jigs', {}),
        step('Alignment check', {
          evidenceRequired: true, evidenceTypes: ['measurement'], minFiles: 0,
          measurement: { enabled: true, name: 'Jig alignment gap', expected: 0.5, tolerance: 0.2, unit: 'mm', required: true }
        })
      ]
    }),
    buildTask('Poka-Yoke', 'Technician', 2, 'days', {
      steps: pokaYokeFullSteps
    }),
    buildTask('Mechanical Adjustment', 'Mechanical Technician', 2, 'days', {
      materials: [req.material('Lubricant Grease', 1, 'kg'), req.material('Thread Locking Compound', 1, 'bottle')],
      tools: [req.tool('Torque Wrench'), req.tool('Digital Caliper')],
      steps: [
        step('Adjust mechanics', { description: 'Adjust belts, rails and mechanical stops.' }),
        step('Torque check', {
          evidenceRequired: true, evidenceTypes: ['measurement'], minFiles: 0,
          measurement: { enabled: true, name: 'Bolt torque', expected: 25, tolerance: 2, unit: 'Nm', required: true }
        })
      ]
    }),
    buildTask('Machine Validation', 'Engineer', 1, 'days', {
      approvalRequired: true,
      steps: validationSteps
    })
  ];
  linkDeps(replacementTasks, 2, [1]);
  linkDeps(replacementTasks, 3, [0]);
  linkDeps(replacementTasks, 4, [2, 3]);
  linkDeps(replacementTasks, 5, [4]);
  linkDeps(replacementTasks, 6, [5]);
  linkDeps(replacementTasks, 7, [5, 6]);

  const assemblyTasks = [
    buildTask('Design Jigs and Table', 'Engineer', 3, 'days', {
      steps: [
        step('Collect requirements from production'),
        step('Create 3D design of jigs and table', { evidenceRequired: true, evidenceTypes: ['pdf'], minFiles: 1 })
      ]
    }),
    buildTask('Order Jigs and Table', 'Engineer', 5, 'days', { steps: [step('Send order to supplier'), step('Track delivery')] }),
    buildTask('Table and Jigs Assembly', 'Technician', 2, 'days', {
      materials: [req.material('Screws M4x20', 30, 'pcs')],
      tools: [req.tool('Torque Wrench')],
      steps: [step('Mount table frame'), step('Install jigs'), step('Alignment check', {
        evidenceRequired: true, evidenceTypes: ['measurement'], minFiles: 0,
        measurement: { enabled: true, name: 'Jig alignment gap', expected: 0.5, tolerance: 0.2, unit: 'mm', required: true }
      })]
    }),
    buildTask('Poka-Yoke', 'Technician', 2, 'days', { steps: pokaYokeShortSteps }),
    buildTask('Machine Validation', 'Engineer', 1, 'days', { approvalRequired: true, steps: validationSteps })
  ];
  linkDeps(assemblyTasks, 1, [0]);
  linkDeps(assemblyTasks, 2, [1]);
  linkDeps(assemblyTasks, 3, [2]);
  linkDeps(assemblyTasks, 4, [3]);

  const refurbishmentTasks = [
    buildTask('Design Jigs and Table', 'Engineer', 3, 'days', {
      steps: [
        step('Inspect actual machine condition'),
        step('Create 3D design / adaptation plan', { evidenceRequired: true, evidenceTypes: ['pdf'], minFiles: 1 })
      ]
    }),
    buildTask('Order spare parts and jigs', 'Engineer', 5, 'days', { steps: [step('Send order to supplier'), step('Track delivery')] }),
    buildTask('Table and Jigs Assembly', 'Technician', 2, 'days', { steps: [step('Dismount old elements'), step('Mount table and jigs'), step('Alignment check', {
      evidenceRequired: true, evidenceTypes: ['measurement'], minFiles: 0,
      measurement: { enabled: true, name: 'Jig alignment gap', expected: 0.5, tolerance: 0.2, unit: 'mm', required: true }
    })] }),
    buildTask('Poka-Yoke', 'Technician', 2, 'days', { steps: pokaYokeShortSteps }),
    buildTask('Machine Validation', 'Engineer', 1, 'days', { approvalRequired: true, steps: validationSteps })
  ];
  linkDeps(refurbishmentTasks, 1, [0]);
  linkDeps(refurbishmentTasks, 2, [1]);
  linkDeps(refurbishmentTasks, 3, [2]);
  linkDeps(refurbishmentTasks, 4, [3]);

  const templates = {};
  templates.REPLACEMENT = await collections.workflowTemplates.insert({
    id: newId('wft'),
    name: 'Machine Replacement',
    description: 'Standard workflow to replace a machine (receiving -> design -> assembly -> poka-yoke -> validation)',
    projectTypeId: projectTypes.REPLACEMENT.id,
    active: true,
    tasks: replacementTasks
  });
  templates.ASSEMBLY = await collections.workflowTemplates.insert({
    id: newId('wft'),
    name: 'Machine Assembly',
    description: 'Standard workflow to assemble a new machine / workstation',
    projectTypeId: projectTypes.ASSEMBLY.id,
    active: true,
    tasks: assemblyTasks
  });
  templates.REFURBISHMENT = await collections.workflowTemplates.insert({
    id: newId('wft'),
    name: 'Machine Refurbishment',
    description: 'Standard workflow to refurbish an existing machine',
    projectTypeId: projectTypes.REFURBISHMENT.id,
    active: true,
    tasks: refurbishmentTasks
  });

  // ---------------------------------------------------------------- demo projects
  const admin = users.admin;

  // 1) JUKI 224EN - Replacement - IN PROGRESS
  const { project: p1 } = await createProject({
    machineName: 'JUKI 224EN',
    machineReference: 'JUKI-224EN-01',
    machineSerial: 'SN-224EN-8891',
    projectTypeId: projectTypes.REPLACEMENT.id,
    templateId: templates.REPLACEMENT.id,
    description: 'Replacement of JUKI 224EN sewing machine on Line 1',
    productionLine: 'Line 1',
    departmentId: departments.Production.id,
    locationId: locations['Plant 1 - Line 1'].id,
    responsibleUserId: users.mohamed.id,
    startDate: daysAgo(40),
    priority: 'high',
    status: 'in_progress'
  }, admin);

  await collections.tasks.transaction((rows) => {
    const tasks = rows.filter((t) => t.projectId === p1.id).sort((a, b) => a.order - b.order);
    const setStep = (task, index, status, who, when) => {
      const s = task.steps[index];
      if (!s) return;
      s.status = status;
      if (status === 'completed') {
        s.startedAt = s.startedAt || when;
        s.completedAt = when;
        s.completedBy = who.id;
      }
    };
    if (tasks[0]) {
      const t = tasks[0];
      t.assignedUserId = users.ahmed.id;
      t.status = 'completed';
      t.actualStart = daysAgo(38);
      t.actualEnd = daysAgo(37);
      setStep(t, 0, 'completed', users.ahmed, daysAgo(37));
      setStep(t, 1, 'completed', users.ahmed, daysAgo(37));
    }
    if (tasks[1]) {
      const t = tasks[1];
      t.assignedUserId = users.mohamed.id;
      t.status = 'completed';
      t.actualStart = daysAgo(37);
      t.actualEnd = daysAgo(32);
      setStep(t, 0, 'completed', users.mohamed, daysAgo(36));
      setStep(t, 1, 'completed', users.mohamed, daysAgo(34));
      setStep(t, 2, 'completed', users.mohamed, daysAgo(32));
    }
    if (tasks[2]) {
      const t = tasks[2];
      t.assignedUserId = users.mohamed.id;
      t.status = 'in_progress';
      t.actualStart = daysAgo(30);
      setStep(t, 0, 'completed', users.mohamed, daysAgo(28));
      setStep(t, 1, 'in_progress', users.mohamed, null);
    }
    if (tasks[3]) {
      tasks[3].assignedUserId = users.karim.id;
      tasks[3].status = 'ready';
    }
    if (tasks[4]) tasks[4].assignedUserId = users.ahmed.id;
    if (tasks[5]) tasks[5].assignedUserId = users.ahmed.id;
    if (tasks[6]) tasks[6].assignedUserId = users.slim.id;
    if (tasks[7]) tasks[7].assignedUserId = users.mohamed.id;
  });
  await syncProjectProgress(p1.id, {});

  // 2) JUKI 224EN - Assembly - COMPLETED (machine history demo, spec section 39)
  const { project: p2 } = await createProject({
    machineName: 'JUKI 224EN',
    machineReference: 'JUKI-224EN-01',
    machineSerial: 'SN-224EN-8891',
    projectTypeId: projectTypes.ASSEMBLY.id,
    templateId: templates.ASSEMBLY.id,
    description: 'Initial assembly of JUKI 224EN workstation',
    productionLine: 'Line 1',
    departmentId: departments.Production.id,
    locationId: locations['Plant 1 - Line 1'].id,
    responsibleUserId: users.mohamed.id,
    startDate: daysAgo(520),
    priority: 'medium'
  }, admin);
  await collections.tasks.transaction((rows) => {
    for (const task of rows.filter((t) => t.projectId === p2.id)) {
      task.status = 'completed';
      task.progress = 100;
      task.actualStart = task.plannedStart || daysAgo(515);
      task.actualEnd = task.plannedEnd || daysAgo(505);
      for (const s of task.steps || []) {
        s.status = 'completed';
        s.completedAt = task.plannedEnd;
        s.completedBy = users.mohamed.id;
      }
    }
  });
  await collections.projects.update(p2.id, { status: 'completed', actualEndDate: daysAgo(505), progress: 100 });

  // 3) JUKI 251EN - Replacement - PLANNED (spec section 41 example)
  await createProject({
    machineName: 'JUKI 251EN',
    machineReference: 'JUKI-251EN-02',
    machineSerial: 'SN-251EN-1204',
    projectTypeId: projectTypes.REPLACEMENT.id,
    templateId: templates.REPLACEMENT.id,
    description: 'Replacement of JUKI 251EN machine - planned for next month',
    productionLine: 'Line 2',
    departmentId: departments.Production.id,
    locationId: locations['Plant 1 - Line 2'].id,
    responsibleUserId: users.mohamed.id,
    startDate: daysFromNow(7),
    priority: 'medium',
    status: 'planned'
  }, admin);

  // ---------------------------------------------------------------- settings + audit
  await singletons.settings.update({ demoData: true });
  await logAudit({
    user: admin,
    action: 'seed',
    entityType: 'system',
    entityId: 'seed',
    entityLabel: 'Demo data',
    details: `Seeded ${Object.keys(roles).length} roles, ${userDefs.length} users, 3 workflow templates and 3 demo projects`
  });

  logger.log('[seed] Done. Login users:');
  for (const def of userDefs) {
    logger.log(`[seed]   ${def.username} / ${def.password}  (${def.role})`);
  }
  return true;
}
