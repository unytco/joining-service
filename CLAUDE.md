# Holo Web Conductor Joining Service

> Joining Service for Browser extension-based Holochain conductor

## Quick Context (READ FIRST)

**Before Coding**:
1. Check [LESSONS_LEARNED.md](./LESSONS_LEARNED.md) for failed approaches on this topic
2. Research in `../holochain` and `../holo-web-conductor` and `../h2hc-linker` first (not web searches)
3. Write test before implementation

---

## Critical Rules

- **Type safety is load-bearing** (READ CAREFULLY):
  Types in this project exist to catch real bugs -- wrong hash sizes, missing fields, shape mismatches at serialization boundaries. Suppressing type errors defeats the purpose. Rules:

  1. **`as any` is a defect in production code.** If the type system can't express the shape, create a named type or interface that documents the actual shape. Never silence the compiler to make it build faster.
  2. **`as unknown as T` requires a comment** explaining why the intermediate shapes are compatible. If you can't explain it, the cast is wrong.
  3. **Run `npm run typecheck` before considering code complete.** Vitest uses esbuild which strips types without checking them. Type errors are invisible in `npm test` alone -- the typecheck step catches them. A green test suite with type errors is not green.
  4. **Test code is code.** Type assertions in tests hide the exact class of bugs that types catch. Specific rules for tests:
     - For partial mocks: use `Pick<T, 'needed' | 'fields'>` or create typed test factory functions -- not `{} as any`.
     - For return value assertions: define the expected return type and assert against it. `(result as any).field` means the test cannot catch a field rename or shape change.
     - For global patching (`window`, `globalThis`): `as any` is acceptable with a one-line comment (e.g., `// browser global not in test types`).
  5. **Never add `// @ts-ignore` or `// @ts-expect-error` without a ticket or TODO** linking to the upstream issue that makes it necessary.

- **Reference sources** (all local, no web searches):
  1. Holochain 0.6: `../holochain`
  2. @holochain/client: `../holochain-client-js`
  3. Linker: `../h2hc-linker`
  4. Holo-web-conductor: ../holo-web-conductor`

- **Commit and PR hygiene**: No claude co-authored messages. Use `npm` for builds. 

- **Communication style**: No emotional tags or exclamation points. Just code-related information.

---