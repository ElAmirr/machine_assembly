// File upload middleware (spec section 45: validate file type + size).
import multer from 'multer';
import path from 'node:path';
import { config } from '../config.js';
import { ALLOWED_EXTENSIONS } from '../constants.js';
import { badRequest } from '../utils.js';

export const MAX_UPLOAD_MB = Math.round(config.maxUploadBytes / (1024 * 1024));

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(badRequest(`File type "${ext || 'unknown'}" is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
  cb(null, true);
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 10 },
  fileFilter
});
