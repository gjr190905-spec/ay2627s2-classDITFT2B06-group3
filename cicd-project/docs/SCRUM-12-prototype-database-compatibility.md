# SCRUM-12 — Prototype PostgreSQL integration

The live local `makan_liao` development database already contains `users` and `sessions`. Do not run the older Person/PersonCredential/PersonSession migrations or the root `schema.sql` against it. That legacy schema uses a different data model and may contain destructive statements.

The authentication integration now reads existing scrypt-v1 password hashes, writes new scrypt-v1 password hashes, and can also verify legacy bcrypt hashes. It uses `users` and `sessions`, stores only session token SHA-256 digests, checks `users.is_active`, resolves roles/stall IDs from PostgreSQL, and uses a separate CSRF token for state-changing requests.

The existing prototype's `/api/auth` response shape is followed: `user` with `displayName`, and `csrfToken`. Signup creates and signs in a customer. GET `/api/auth/me` returns `user: null` when signed out. POST `/api/auth/logout` needs cookie + `X-CSRF-Token` header and returns `{ "ok": true }`.

Local test workflow: use a **development** database, `npm run test:unit` and `npm run lint`, then test signup -> /me -> logout -> /me -> login. Use a disposable new email for signup. Do not edit existing 24 account records for verification.

The original Day 8–15 patches still reference the `Person` schema and/or HTTP Basic authentication. Update them to use the actual session middleware and `users` before applying them.
