// Machine Assembly Manager - application server.
//
// Serves the REST API (/api/...) and, in production, the built React client.
// All data lives in JSON files inside DATA_DIR (local folder or shared network folder).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initStorage } from './storage/db.js';
import { initBlobStore } from './storage/blobStore.js';
import { createBackup, listBackups, startBackupScheduler } from './storage/backup.js';
import { seedIfEmpty } from './core/seed.js';
import { requireAuth } from './middleware/auth.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { authRouter, healthRouter } from './routes/auth.js';
import {
  adminRouter, departmentsRouter, locationsRouter, projectTypesRouter, evidenceTypesRouter
} from './routes/admin.js';
import { workflowsRouter } from './routes/workflows.js';
import { inventoryRouter } from './routes/inventory.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { collabRouter } from './routes/collab.js';
import { insightsRouter } from './routes/insights.js';
import { startScheduler } from './services/scheduler.js';

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}

async function main() {
  // 1. storage (creates the data folder + JSON files, verifies write access)
  await initStorage();
  await initBlobStore();

  // 2. first-start demo data
  await seedIfEmpty(console);

  // 3. periodic safety backup (also once on startup when the last one is old)
  try {
    const backups = await listBackups();
    const newest = backups[0]?.at ? new Date(backups[0].at).getTime() : 0;
    if (Date.now() - newest > 6 * 60 * 60 * 1000) {
      const result = await createBackup('startup');
      console.log(`[backup] startup backup created (${result.files} files) -> ${result.dir}`);
    }
  } catch (err) {
    console.warn('[backup] startup backup failed:', err.message);
  }
  startBackupScheduler();
  startScheduler();

  // 4. express app
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', adminRouter);
  app.use('/api', departmentsRouter);
  app.use('/api', locationsRouter);
  app.use('/api', projectTypesRouter);
  app.use('/api', evidenceTypesRouter);
  app.use('/api', workflowsRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', projectsRouter);
  app.use('/api', tasksRouter);
  app.use('/api', collabRouter);
  app.use('/api', insightsRouter);

  // 5. static client (built with "npm run build")
  const distIndex = path.join(config.distDir, 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(express.static(config.distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(distIndex);
    });
  } else {
    app.get('/', (req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('The web client is not built yet.\n\nRun:  npm run build   then restart, or use "npm run dev" during development.\nThe API is available under /api (see /api/health).');
    });
  }

  app.use('/api', (req, res) => notFoundHandler(req, res));
  app.use(errorHandler);

  const server = app.listen(config.port, '0.0.0.0', () => {
    const lines = [];
    lines.push('');
    lines.push('==========================================================');
    lines.push(`  ${config.appName}`);
    lines.push('==========================================================');
    lines.push(`  Data folder : ${config.dataDir}`);
    lines.push(config.dataDir.includes('\\\\') || /^[A-Za-z]:\\/.test(config.dataDir)
      ? '  (shared-folder JSON database - safe for multiple PCs)'
      : '  (local JSON database)');
    lines.push(`  Local URL   : http://localhost:${config.port}`);
    for (const address of lanAddresses()) {
      lines.push(`  Network URL : http://${address}:${config.port}   <- other PCs use this`);
    }
    lines.push('');
    if (config.isDefaultSecret) {
      lines.push('  WARNING: JWT_SECRET is not configured in .env - please set a long random value.');
    }
    if (!fs.existsSync(distIndex)) {
      lines.push('  NOTE: run "npm run build" once to build the web client, or use "npm run dev".');
    }
    lines.push('==========================================================');
    lines.push('');
    console.log(lines.join('\n'));
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}

main().catch((err) => {
  console.error('');
  console.error('FATAL: the server could not start.');
  console.error(`  ${err.message}`);
  console.error('');
  console.error('Checklist:');
  console.error('  - Is the data folder reachable? (DATA_DIR in .env)');
  console.error('  - Does the current PC have write permission on it?');
  console.error('  - For network paths, is the share online and authorized?');
  process.exit(1);
});
