import { describe, it, expect } from 'vitest';
import { DEFAULT_REDACT_FIELDS, DEFAULT_REDACT_HEADERS, REDACT_MARKER, createRedactor, redactValue, redactHeaders, } from '../src/runtime/redaction.js';
describe('runtime/redaction', () => {
    it('default deny-list contains the mandatory sensitive keys', () => {
        for (const key of ['password', 'pwd', 'token', 'authorization', 'cookie', 'set-cookie', 'api_key']) {
            expect(DEFAULT_REDACT_FIELDS.map((s) => s.toLowerCase())).toContain(key);
        }
    });
    it('default header deny-list contains authorization / cookie / set-cookie', () => {
        for (const key of ['authorization', 'cookie', 'set-cookie', 'x-api-key']) {
            expect(DEFAULT_REDACT_HEADERS.map((s) => s.toLowerCase())).toContain(key);
        }
    });
    it('redacts nested object fields case-insensitively', () => {
        const out = redactValue({
            username: 'alice',
            Password: 'hunter2',
            nested: { Authorization: 'Bearer abc' },
        });
        expect(out.username).toBe('alice');
        expect(out.Password).toBe(REDACT_MARKER);
        expect(out.nested.Authorization).toBe(REDACT_MARKER);
    });
    it('redacts arrays element-by-element without losing order', () => {
        const out = redactValue([{ token: 't1' }, { token: 't2' }, { safe: 1 }]);
        expect(out[0].token).toBe(REDACT_MARKER);
        expect(out[1].token).toBe(REDACT_MARKER);
        expect(out[2].safe).toBe(1);
    });
    it('caps recursion depth to prevent stack overflow', () => {
        const deep = { a: { b: { c: { d: { e: { password: 'leak' } } } } } };
        const out = redactValue(deep, { maxDepth: 2 });
        const walk = (v, depth) => {
            if (depth > 6)
                return '…';
            if (v && typeof v === 'object') {
                const r = {};
                for (const [k, val] of Object.entries(v))
                    r[k] = walk(val, depth + 1);
                return r;
            }
            return v;
        };
        expect(JSON.stringify(walk(out, 0))).toContain(REDACT_MARKER);
    });
    it('honours per-system custom field overrides', () => {
        const out = redactValue({ tenantSecret: 'shh', safe: 'ok' }, { fields: ['tenantsecret'] });
        expect(out.tenantSecret).toBe(REDACT_MARKER);
        expect(out.safe).toBe('ok');
    });
    it('redactHeaders redacts the default header set and respects overrides', () => {
        const out = redactHeaders({
            Authorization: 'Bearer abc',
            'Content-Type': 'application/json',
            'X-Tenant': 'acme',
        }, { headers: ['x-tenant'] });
        expect(out.Authorization).toBe(REDACT_MARKER);
        expect(out['Content-Type']).toBe('application/json');
        expect(out['X-Tenant']).toBe(REDACT_MARKER);
    });
    it('createRedactor returns a function with redactHeaders attached', () => {
        const fn = createRedactor();
        expect(typeof fn).toBe('function');
        expect(typeof fn.redactHeaders).toBe('function');
    });
    it('never mutates input objects', () => {
        const input = { password: 'x', nested: { token: 'y' } };
        const snapshot = JSON.stringify(input);
        redactValue(input);
        expect(JSON.stringify(input)).toBe(snapshot);
    });
    it('handles null / undefined / primitives without throwing', () => {
        expect(redactValue(null)).toBeNull();
        expect(redactValue(undefined)).toBeUndefined();
        expect(redactValue('hello')).toBe('hello');
        expect(redactValue(42)).toBe(42);
        expect(redactValue(true)).toBe(true);
    });
});
//# sourceMappingURL=redaction.test.js.map