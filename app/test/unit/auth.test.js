import { describe, it, expect } from 'vitest';
import { sign, verify, parseCookies, cookie } from '../../src/services/auth.js';

describe('auth', () => {
  it('round-trips a signed value', () => {
    expect(verify(sign('WS_ABC123', 's3cret'), 's3cret')).toBe('WS_ABC123');
  });
  it('rejects tampering and wrong secrets', () => {
    const t = sign('WS_ABC123', 's3cret');
    expect(verify(t.replace('ABC', 'XYZ'), 's3cret')).toBeNull();
    expect(verify(t, 'other')).toBeNull();
    expect(verify('garbage', 's3cret')).toBeNull();
    expect(verify(undefined, 's3cret')).toBeNull();
  });
  it('parses cookie headers', () => {
    expect(parseCookies('a=1; lab_sid=x.y; b=%20z')).toEqual({ a: '1', lab_sid: 'x.y', b: ' z' });
    expect(parseCookies(undefined)).toEqual({});
  });
  it('builds an HttpOnly cookie', () => {
    expect(cookie('lab_sid', 'v', { maxAgeSec: 60 })).toBe('lab_sid=v; Max-Age=60; Path=/; HttpOnly; SameSite=Lax');
  });
});
