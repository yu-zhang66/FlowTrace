/**
 * Generic redaction utility for FlowTrace builtin runtime evidence.
 *
 * Default deny-list covers passwords, cookies, authorization headers, tokens,
 * configured sensitive fields and per-system `redact.fields` / `redact.headers`
 * overrides. The redaction policy MUST be applied before any evidence frame
 * is persisted or rendered into a report.
 *
 * This module MUST NOT contain any business identifier (URL, account, scenario
 * id, business state name, transition rule, error code, role name).
 */
export const DEFAULT_REDACT_FIELDS = Object.freeze([
    'password',
    'pwd',
    'pass',
    'passwd',
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'auth',
    'api_key',
    'apikey',
    'secret',
    'cookie',
    'set-cookie',
    'session',
    'sessionid',
    'credential',
    'credentials',
    'private_key',
    'privatekey',
    'x-api-key',
    'x-auth-token',
]);
export const DEFAULT_REDACT_HEADERS = Object.freeze([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
]);
export const REDACT_MARKER = '[redacted]';
const FROZEN_DEFAULT_FIELDS = new Set(DEFAULT_REDACT_FIELDS.map((s) => s.toLowerCase()));
const FROZEN_DEFAULT_HEADERS = new Set(DEFAULT_REDACT_HEADERS.map((s) => s.toLowerCase()));
/**
 * Build a low-level redactor using the default deny-list plus caller-supplied
 * extensions. The returned function applies the policy recursively to any
 * structured value (object/array/string/number/boolean).
 */
export function createRedactor(options = {}) {
    const fieldSet = new Set(FROZEN_DEFAULT_FIELDS);
    for (const f of options.fields ?? [])
        fieldSet.add(String(f).toLowerCase());
    const headerSet = new Set(FROZEN_DEFAULT_HEADERS);
    for (const h of options.headers ?? [])
        headerSet.add(String(h).toLowerCase());
    const maxDepth = options.maxDepth ?? 8;
    const redactKey = (key) => fieldSet.has(key.toLowerCase());
    const redactHeader = (key) => headerSet.has(key.toLowerCase());
    const walk = (value, depth) => {
        if (depth > maxDepth)
            return REDACT_MARKER;
        if (value === null || value === undefined)
            return value;
        const t = typeof value;
        if (t === 'string' || t === 'number' || t === 'boolean')
            return value;
        if (Array.isArray(value))
            return value.map((v) => walk(v, depth + 1));
        if (t === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = redactKey(k) ? REDACT_MARKER : walk(v, depth + 1);
            }
            return out;
        }
        return String(value);
    };
    const redactHeaders = (headers) => {
        if (!headers || typeof headers !== 'object')
            return headers;
        const out = {};
        for (const [k, v] of Object.entries(headers)) {
            out[k] = redactHeader(k) ? REDACT_MARKER : walk(v, 1);
        }
        return out;
    };
    const top = ((value) => walk(value, 0));
    top.redactHeaders = redactHeaders;
    return top;
}
/**
 * Convenience helper: redact a structured value with default policy plus
 * caller-supplied field/header extensions. Returns a fresh value (does not
 * mutate input).
 */
export function redactValue(value, options = {}) {
    return createRedactor(options)(value);
}
/**
 * Redact HTTP-style headers using the default policy plus caller extensions.
 * Always returns an object; if input is not an object it is returned unchanged.
 */
export function redactHeaders(headers, options = {}) {
    return createRedactor(options).redactHeaders(headers);
}
//# sourceMappingURL=redaction.js.map