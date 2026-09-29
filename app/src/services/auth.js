// app/src/services/auth.js
import crypto from 'node:crypto';

const mac = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

export function sign(value, secret) {
  return `${value}.${mac(value, secret)}`;
}

export function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const value = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(mac(value, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAgeSec }) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax`;
}
