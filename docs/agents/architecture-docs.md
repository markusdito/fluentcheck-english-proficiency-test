# Architecture documentation

These documents describe the behavior that exists in this repository:

- [Backend architecture](../../backend/docs/BACKEND_ARCHITECTURE.md)
- [Frontend architecture](../../frontend/docs/FRONTEND_ARCHITECTURE.md)

The source code, Prisma schema, and focused tests are authoritative. The
architecture documents explain current behavior and point to those sources;
they are not a second implementation specification.

## Inventory markers

The backend document contains one marker for every route declaration,
including conditionally enabled OAuth routes:

    <!-- route: METHOD /path | source=relative/source/file.ts -->

The frontend document contains one marker for every app/**/page.tsx route:

    <!-- page: /path | source=frontend/app/path/page.tsx -->

Run the dependency-free inventory check from the repository root:

~~~sh
node scripts/check-architecture-docs.mjs
~~~

It detects missing and stale route/page markers, duplicate markers, and source
file mismatches. It intentionally does not attempt to interpret prose or
validate response payloads.

## When code changes

For a backend change, inspect the backend document whenever a route, mounted
middleware, authentication or authorization rule, upload/storage flow,
payment flow, assignment invariant, scoring lifecycle, persistence model, or
failure behavior changes. Update the route marker and its row when the route
surface changes.

For a frontend change, inspect the frontend document whenever an App Router
page, layout, component, hook, API module, recording/upload flow, session
boundary, or user-visible lifecycle state changes. Update page markers when
the route tree changes.

Use Implemented for behavior reachable from the current application. Use
Planned for future work, compatibility ideas, or intentionally unsupported
paths. Do not describe a planned control as if it protects a live endpoint.

## Review checklist

Before merging architecture-affecting work, a maintainer should confirm:

1. The inventory check passes.
2. Every documented endpoint and major page/component/module still exists.
3. Route access, middleware, storage boundaries, and state transitions match
   the implementation.
4. Upload, authentication, payment, assignment, scoring, and certification
   statements distinguish enforced behavior from schema-only or planned
   behavior.
5. Transitional and legacy behavior is labeled without replacing the primary
   current flow.
6. Each important flow points to a source file and, where useful, a focused
   test.

The CI change gate runs the same checker with DOCS_BASE_SHA. Backend
route/domain changes require a review of the backend document; frontend
route/feature changes require a review of the frontend document. The gate is a
prompt to review, not a substitute for the semantic checklist above.
