# Makan Liao CA2 database setup

This ZIP is a copy-in overlay for the existing school starter project. Merge
the enclosed `cicd-project` folder into your existing `cicd-project` folder.
Accept replacement of `prisma/schema.prisma` and keep your local environment
files. The initial starter migration is included unchanged. If your copy has
additional migrations or a modified starter migration, compare histories
before merging or deploying.

## 1. Prepare the CA2 database in pgAdmin

Connect to the local PostgreSQL server. Under **Databases**, look for
`makan_liao_ca2_dev`. If missing, right-click **Databases → Create →
Database**, name it `makan_liao_ca2_dev`, and select as owner the local role
you will use in the connection URL. The migrations create the PostgreSQL
schema `makan_liao` automatically.

Open Query Tool under **makan_liao_ca2_dev** and run:

```sql
SELECT current_database();
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname IN ('public', 'makan_liao')
ORDER BY schemaname, tablename;
```

A fresh database returns `makan_liao_ca2_dev` and zero tables. A rerun on a
database you have already set up may show existing CA2 tables. If you see
DBS tables or unexpected migration history, check which database you selected
before proceeding. Keep your DBS database separate.

## 2. Apply the migrations

Open PowerShell in the project folder that contains `package.json`.
If `.env` is missing, run `Copy-Item .env.example .env`.
Edit the existing `.env` in place otherwise. Set the connection locally:

```dotenv
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/makan_liao_ca2_dev?schema=makan_liao"
```

URL-encode any reserved characters in the password. Keep credentials private.
Prisma loads `.env` from the project root. A pre-existing PowerShell
`DATABASE_URL` environment variable takes precedence over `.env`.

```powershell
npm.cmd ci
npm.cmd run db:validate
npm.cmd run db:migrate:status
```

Check that Prisma reports database `makan_liao_ca2_dev` and schema
`makan_liao`. Pending migrations are expected on the first run. Once the
target is correct, run:

```powershell
npm.cmd run db:migrate:deploy
npm.cmd run db:generate
npm.cmd run db:migrate:status
```

Expect both migrations applied and **Database schema is up to date!**.
Use these Prisma commands for this database. The project's legacy
`migration:reset` command drops starter tables and uses a different setup.

## 3. Verify in pgAdmin

Run `verify-ca2.sql` in Query Tool for the CA2 database. It checks the 11
CA2 tables, five named check constraints and both migration records.
It also runs a rollback-only smoke test with temporary food courts, stalls, a
customer and a cart. Sequence IDs can advance even though the rows roll back.
The final message should say the smoke test passed. Refresh
**Schemas → makan_liao → Tables** to see the objects.

Optionally run `seed-food-courts.sql` in the same database for FC1–FC6.
Re-running that seed keeps existing values for matching codes.

## Scope and decisions

The migration implements the CA2 handoff model, retains the two starter tables,
and uses the Prisma 6.19.3 CommonJS client. The database enforces positive
prices and quantities, nonnegative totals, vendor assignment, and single-stall
cart and order items. It stores checkout request IDs uniquely per customer,
order snapshots, status events and admin audit records. Vendor-to-stall
assignment and automatic ACCEPTED status follow the current SRS assumptions.

Future application work includes access and ownership checks, email
normalisation, checkout transactions and server-calculated totals, price and
availability validation, status transitions, audit redaction and session logic.
The starter Express app still uses its existing `pg` connection. This package
ends at database creation and verification.

