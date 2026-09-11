// Central error handling: consistent JSON error responses.
export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Multer upload errors (file too large, ...)
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `The file is too large. Maximum allowed size is ${Math.round((err.limit || 0) / (1024 * 1024))} MB.`
      : `Upload error: ${err.message}`;
    return res.status(400).json({ error: { message } });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  }
  res.status(status).json({
    error: {
      message: err.message || 'Unexpected server error',
      details: err.details || undefined
    }
  });
}
