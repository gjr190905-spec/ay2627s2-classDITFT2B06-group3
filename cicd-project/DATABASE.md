# Database setup

Prisma CLI and client remain at 6.19.3. `prisma.config.ts` loads `.env`
and uses `prisma/schema.prisma` and `prisma/migrations`.
For this Prisma workflow, the schema and migration files are authoritative.

## Verified local target

On 18 November 2026, `.env` selected database `makan_liao` on
`localhost:5432`. The database already existed. Before migration, there were
no user tables or migration records and only `public` existed as an app schema.
The PostgreSQL schema `makan_liao` is a separate namespace from the database,
even though this local configuration uses the same name for both.

The local URL now includes `schema=makan_liao`. Keep the database path,
credentials, and all other URL parameters when adding or replacing this parameter
in another environment. Configure credentials locally; do not share them.
`.env.example` contains placeholders, not a request to create another database.

## Model scope

The repository, including its ZIP listing, contains no canteen ERD or business
requirements. Only the starter `schema.sql` defines a data model:

- `Person`: auto-increment integer primary key, required unique email,
  required name, nullable avatar.
- `Something`: auto-increment integer primary key and required name.

These names and constraints are preserved because existing models and seed SQL
use them. No foreign keys are defined: no relationship is established by the
available requirements. No speculative canteen entities or indexes were added.
The confirmed canteen entities, fields, cardinalities, uniqueness rules, and
deletion behavior are still needed before designing the actual Makan Liao model.

## Non-destructive Prisma workflow

Run from `cicd-project`:

```powershell
npm run db:format
npm run db:validate
npm run db:migrate:status
# After an approved model change, prepare SQL for review:
npm run db:migrate:create -- --name descriptive_change
# Review prisma/migrations/<timestamp>_descriptive_change/migration.sql first.
npm run db:migrate:deploy
npm run db:generate
```

The initial migration was generated with Prisma's empty-to-model diff,
reviewed, explicitly qualified with `makan_liao`, and wrapped in a transaction.
It only creates the schema, two tables, and the email unique index.
It was applied with `prisma migrate deploy`, avoiding a shadow database or reset.
The completed migration is `20261118130000_init_starter`.

`migrate dev --create-only` is the review workflow for subsequent local changes;
it may require shadow database privileges and can prompt for a reset on drift.
Stop if it requests a reset. Do not approve resets, drops, or data moves without
the database owner's explicit approval. Never edit an already-applied migration.

The old `migration:reset`, `schema.sql`, integration tests, and E2E setup are
legacy starter tooling that drops tables. They were not run and must not be used
to provision this database. The README's older reset instructions describe that
starter workflow, not the Prisma workflow above.

The existing Express app and seed scripts use `pg`, with unqualified SQL.
Prisma's `schema` URL parameter does not configure `pg`'s `search_path`.
Application connection configuration or qualified queries will be needed before
those features use the new schema; application changes are outside this task.
The app scripts also load `.env.dev`, whereas Prisma loads `.env`.

## Existing public data in other environments

Changing the URL schema does not move tables, copy data, or transfer
`public._prisma_migrations`. Prisma uses migration history in the selected
schema; an existing public history would remain separate. Inspect both schemas
before applying elsewhere. If public app tables/history exist, stop and agree
on a migration/baseline and data-move plan before changing anything.

## pgAdmin verification

No database or schema creation is needed on the verified local target.
Select the local server, then **Databases > makan_liao** (the database),
right-click it and select **Query Tool**. Run this read-only SQL:

```sql
SELECT current_database();

SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('public', 'makan_liao');

SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname IN ('public', 'makan_liao')
ORDER BY schemaname, tablename;

SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'makan_liao'
  AND table_name IN ('Person', 'Something')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexdef
FROM pg_indexes WHERE schemaname = 'makan_liao'
ORDER BY tablename, indexname;

SELECT conrelid::regclass AS table_name, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'makan_liao'::regnamespace;

SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM makan_liao._prisma_migrations;
```

Expect database `makan_liao`; the three tables `Person`, `Something`, and
`_prisma_migrations` in schema `makan_liao`; integer sequence defaults on both
IDs; both primary keys; unique `Person_email_key`; and one migration record with
non-null `finished_at`, null `rolled_back_at`, and `applied_steps_count = 1`.
There are no foreign keys in the confirmed starter model.
Refresh **Schemas > makan_liao > Tables** to see the same objects in pgAdmin.

Schema drift can also be checked without exposing credentials:

```powershell
npx --no-install prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Exit code 0 and an empty difference mean the live schema matches the model.
