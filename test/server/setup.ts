// Per-worker setup. Intentionally minimal: the heavy lifting (migrations) runs
// once in global-setup.ts, and each test file cleans the database in its own
// beforeEach via resetDb(). Kept as a named setup file so the wiring is obvious
// and there's an anchor for future global test hooks.
export {}
