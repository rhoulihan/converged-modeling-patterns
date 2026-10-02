import express from 'express';
import { verify, parseCookies } from '../services/auth.js';

const DECK = 'converged-data-modeling-workshop1.html';

const SIGN_IN = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Instructor deck</title>
<link rel="stylesheet" href="/css/lab.css"></head><body><main style="padding:24px">
<h2>The instructor deck needs the instructor sign-in</h2>
<p><a href="/admin.html">Sign in on the admin page</a>, then open the deck from there.</p>
</main></body></html>`;

// Serves the Workshop 1 deck (presentations/: the HTML, images/ and fonts/) at /deck/, so the
// lab host carries the presentation as well as the lab. The deck includes the speaker notes, so
// in event mode it needs the instructor's admin cookie; solo mode has no sign-in and serves it
// openly. The deck's build tooling (presentations/build/) is never served.
export function deckRouter({ cfg, sessionSecret }) {
  const r = express.Router();
  r.use((req, res, next) => {
    if (req.originalUrl.split('?')[0] === req.baseUrl) return res.redirect(301, `${req.baseUrl}/`);
    if (cfg.mode === 'event' && verify(parseCookies(req.headers.cookie).lab_admin, sessionSecret) !== 'admin') {
      return res.status(401).type('html').send(SIGN_IN);
    }
    let first;
    try { first = decodeURIComponent(req.path).split('/')[1]; } catch { return res.status(404).end(); }
    if (first === 'build') return res.status(404).end();
    return next();
  });
  r.use(express.static(cfg.presentationsDir, {
    index: DECK,
    dotfiles: 'deny',
    redirect: false,
    // Gated content: keep it out of shared caches.
    setHeaders: (res) => res.set('Cache-Control', cfg.mode === 'event' ? 'private, max-age=300' : 'public, max-age=300'),
  }));
  // Anything not found, including traversal attempts the static handler refuses, is a 404.
  r.use((req, res) => res.status(404).end());
  return r;
}
