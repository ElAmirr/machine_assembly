// CLI: reset + reseed the database. Usage:  npm run seed -- --force
import { initStorage } from '../storage/db.js';
import { initBlobStore } from '../storage/blobStore.js';
import { seedNow } from '../core/seed.js';
import { config } from '../config.js';

const force = process.argv.includes('--force');

console.log(`Data folder: ${config.dataDir}`);
await initStorage();
await initBlobStore();

if (force) {
  console.log('Force mode: existing JSON data files will be reset before seeding.');
}
const done = await seedNow({ force, logger: console });
if (!done) {
  console.log('Nothing to do. Use: npm run seed -- --force   to reset + reseed.');
  process.exit(0);
}
console.log('Reseed complete.');
process.exit(0);
