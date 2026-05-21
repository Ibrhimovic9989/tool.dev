// Stub for the `server-only` package when running the eval harness via tsx.
// In a real Next.js build the package's body throws to enforce "this code
// must not ship to the client." The eval runs in Node, server-side, so the
// guard is moot — but the throw still fires. We alias `server-only` to this
// file via tsconfig-paths in tsconfig.eval.json.
export {};
