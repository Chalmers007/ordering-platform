// `server-only` throws on import outside a React Server Component, which makes
// every module that imports it untestable. Aliased to this no-op in
// vitest.config.ts so route handlers and their guards can be exercised
// directly. Production resolution is untouched.
export {};
