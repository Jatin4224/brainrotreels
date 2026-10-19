/**
 * SOURCE OF TRUTH KEYWORDS: SERVER_ONLY_STUB, server-only, vitest alias
 *
 * WHAT:  An empty stand-in for the `server-only` package under test.
 * WHY:   `server-only` exists to make a build fail when server code is pulled
 *        into a client bundle. Outside Next's bundler it resolves to a module
 *        that throws on import, which would make every service file untestable
 *        — and `import 'server-only'` is mandatory in src/services/**, enforced
 *        by eslint. Stubbing it keeps the production guarantee intact while
 *        letting the same files be imported by the test runner.
 * WHERE: Aliased in vitest.config.ts. Never imported directly.
 */

export {}
