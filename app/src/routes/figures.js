import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const NAME = /^[a-z0-9-]+\.svg$/;

// Serves exported deck figures from patterns/<id>/figures/. The pattern id must be a loaded
// pattern and the file a plain lower-case .svg name, so nothing outside that folder is reachable.
export function figuresRouter({ cfg, patterns }) {
  const r = express.Router();
  const ids = new Set(patterns.map((p) => p.id));
  r.get('/:pattern/:file', (req, res) => {
    const { pattern, file } = req.params;
    if (!ids.has(pattern) || !NAME.test(file)) return res.status(404).end();
    const full = path.join(cfg.patternsDir, pattern, 'figures', file);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.set('Content-Type', 'image/svg+xml');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=3600');
    // Opened full size in its own tab an SVG is a document, so lock it down: no scripts, no loads.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    // A file removed between existsSync and the read (or any read error) is a 404, not a 500.
    return res.sendFile(full, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
  return r;
}
