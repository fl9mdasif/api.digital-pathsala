# School Management SaaS: Server

Multi-tenant School Management ERP backend for schools, madrasas and coaching centers in Bangladesh. One deployment and one MongoDB database serve many institutions (tenants). Node.js 22, Express 5, TypeScript (strict), MongoDB (Mongoose 9), Zod.

- WHAT it must do: [`../a-docs/school-management-prd-server.md`](../a-docs/school-management-prd-server.md)
- HOW it is built: [`../a-docs/school-management-sop-server.md`](../a-docs/school-management-sop-server.md)
- Build progress: [`../CHECKLIST.md`](../CHECKLIST.md) and `../development-tracker.html` (project root)
- API reference: [`docs/openapi.json`](docs/openapi.json) (OpenAPI 3.1, generated from the live routes)
- Security review: [`docs/SECURITY.md`](docs/SECURITY.md)

## সূচিপত্র (Table of contents)

1. [Status](#1-status)
2. [Quick start](#2-quick-start)
3. [Configuration](#3-configuration)
4. [Architecture](#4-architecture)
5. [Domain modules](#5-domain-modules)
6. [API conventions](#6-api-conventions)
7. [Testing](#7-testing)
8. [Security](#8-security)
9. [Operations](#9-operations)
10. [Decisions and deviations from the PRD](#10-decisions-and-deviations-from-the-prd)
11. [Known limitations and launch checklist](#11-known-limitations-and-launch-checklist)
12. [Repository layout and conventions](#12-repository-layout-and-conventions)

---

## 1. Status

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation: env, logging, errors, tenant context and plugins, isolation harness, CI | Done |
| 1 | Tenancy and identity: signup, login, refresh rotation, staff, platform console | Done |
| 2 | Academic core: sessions, classes, sections, subjects, students, guardians, CSV import, promotion | Done |
| 3 | Daily operations: attendance, notices, public site, inquiries, uploads, public API, dashboard | Done |
| 4 | Money: fee setup, idempotent invoicing, payments, append-only ledger, receipts, reports | Done |
| 5 | Exams and results: grading engine, marks entry, publish, correction, marksheet, public lookup | Done |
| 6 | SMS and custom domains | **Dropped by the owner** (no paid SMS provider, no custom domains) |
| 7 | Hardening: audit viewer, Docker, backups, load gates, OpenAPI, Sentry | Done, except staging and production deploy (owner task) |
| R1 | HR and teachers, teacher attendance and leave, class and exam routines, ID and admit cards, fail list and tabulation | Done |
| R4 | Show-ready demo seed, admin overview, seat plan, teacher ID card, testimonials | Done |
| R5 | Public site fields, live stats, fee and admission lookups | Done; security audit pending |
| R2, R3 | General accounts, combined exam, result summary, online admission, certificates, biometric, payment gateway and more | Not started. SMS is parked by the owner |

Test and quality status is in [Testing](#7-testing).

## 2. Quick start

Requirements: Node 22+, a MongoDB **replica set** (transactions need one: Atlas works, or use the compose file below).

```bash
cp .env.example .env        # then fill it in, see Configuration
npm install
npm run seed:plans          # free / basic / pro
npm run seed:admin          # platform owner from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASS
npm run seed:demo           # optional: full demo school (admin@demo.school / Demo@1234, school demo-school)
npm run dev                 # http://localhost:5000/api/v1/health
```

With Docker (API plus a one-node MongoDB replica set):

```bash
docker compose up -d --build
docker compose exec api node -e "console.log('up')"
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Start with reload (tsx watch) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint |
| `npm test` | Whole test suite (in-memory MongoDB replica set, no setup needed) |
| `RUN_PERF=1 npx vitest run tests/perf.test.ts` | Opt-in performance gates |
| `npm run docs:api` | Regenerate `docs/openapi.json` |
| `npm run smoke` | Post-restore sanity check against `DATABASE_URL` |
| `npm run seed:plans`, `npm run seed:admin`, `npm run seed:demo` | Idempotent seeds (demo school is skipped if it already exists) |

## 3. Configuration

All configuration is environment variables, validated with Zod at boot. The process refuses to start on an invalid environment. Tests never read `.env`.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` (default), `test`, `production` |
| `PORT` | no | Default `5000` |
| `DATABASE_URL` | yes | MongoDB replica set URI |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | yes | At least 16 characters; use 48 random bytes in production |
| `JWT_ACCESS_EXPIRES_IN` | no | Default `15m`. Keep it short: a long value delays role changes |
| `JWT_REFRESH_EXPIRES_IN` | no | Default `7d` for staff. Students and guardians are fixed at 30 days |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASS` | for seeding | Password must be 12+ characters in production |
| `PLATFORM_NAME`, `PLATFORM_DOMAIN` | no | The product name and domain are placeholders, never hard coded |
| `RESERVED_SLUGS` | no | Extra reserved school slugs, comma separated |
| `CORS_ORIGINS` | no | Dashboard origins allowed with credentials |
| `COOKIE_SECURE` | no | Defaults to true in production |
| `UPLOAD_PROVIDER` | no | `mock` (default) or `cloudinary` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | with Cloudinary | Secret stays on the server |
| `SENTRY_DSN` | no | Error reporting is off without it |
| `PUBLIC_CACHE_TTL_MS` | no | Public lookup cache, default 15000. `0` disables |
| `LOG_LEVEL` | no | pino level |

`BCRYPT_SALT_ROUND` in older `.env` files is ignored: passwords use argon2id.

## 4. Architecture

```
Client ──> Express 5
            ├─ requestId          (AsyncLocalStorage context starts here)
            ├─ pino-http, helmet, rate limits, CORS, JSON 1 MB, sanitize
            ├─ authenticate()     tenant comes ONLY from the JWT
            ├─ roleGuard(...)     then ownership checks in services
            ├─ validateRequest()  Zod on body, query, params (unknown keys rejected)
            └─ controller ─> service ─> Mongoose model (tenantScoped plugin)
```

### 4.1 Multi-tenancy (the invariant everything else depends on)

- Every tenant-owned collection has a required `tenantId`, injected by the `tenantScoped` plugin.
- The active tenant lives in an `AsyncLocalStorage` context. Authenticated requests get it from the verified JWT; public requests get it from the `:slug` path segment. A `tenantId` in a body, query or path on an authenticated route is rejected.
- **A query with no tenant context throws.** The only escape is `.unscoped()` / `runUnscoped()`, allowed in platform, auth, tenant, audit, public and job code only. A test scans the source and fails the build if it appears anywhere else.
- `bulkWrite` bypasses model middleware, so `scopedBulkWrite` injects the tenant by hand.
- Platform-level collections (`Plan`, `Tenant`, `PlatformAdmin`, `RefreshToken`, `SubscriptionPayment`) are listed explicitly in `PLATFORM_MODELS`; a test fails if any other model lacks `tenantId`.
- A cross-tenant attack suite replays tenant A's token against tenant B's ids on every route family.

### 4.2 Identity and sessions

- Login is `tenantSlug + identifier (email, phone or student ID) + password`. Wrong slug, wrong password and inactive user return the same generic error, with a timing-equalising dummy hash.
- Access JWT (short), refresh token in an httpOnly SameSite=Lax cookie scoped to `/api/v1/auth`, stored hashed, **rotated on every use**. Presenting an already-used token revokes the whole family. Two parallel refreshes cannot both win (atomic claim).
- Student and guardian access is always filtered to linked student ids on the server. Teacher scope is derived from `ClassSubject.teacherId` and `Section.classTeacherId`, never from a client-supplied list.
- Suspended tenants: non-admin users are blocked, the admin gets read-only access plus billing, and the public site and published result lookup **stay online**.

### 4.3 Money

- Amounts are integer poisha (1 BDT = 100 poisha). Percent discounts round half up, only there.
- `LedgerEntry` is append-only: update and delete throw at the model layer. Corrections are new reversal entries.
- Every multi-document write is a MongoDB transaction. Payments update the invoice with a single conditional pipeline update (`dueAmount >= amount`), so two simultaneous payments can never overpay.
- Invoice generation and payments require an `Idempotency-Key` header; a repeat returns the original result. A second invoice for the same student, session, period and fee heads is skipped and reported.
- Online gateways are out of scope; the `Payment` shape already carries `provider`, `providerRef` and `idempotencyKey` for a later adapter.
- A nightly job (`ledgerConsistency`, 02:00 Asia/Dhaka) recomputes every invoice from the ledger and logs any mismatch.

### 4.4 Results

- The grading engine (`result.engine.ts`) is a **pure function**: no database, no clock. All rules (pass percent, component pass marks, absent handling, grace marks, fourth-subject bonus, merit tie-break) come from the grading scale document, so a rule correction is a config change, not a deploy.
- Mark states: `draft` -> `submitted` (teacher locked, admin can unlock) -> `locked` (after publish). Results: `draft` -> `published` (immutable).
- Publish refuses incomplete marks unless `forceMissingAsAbsent`, recalculates, then locks one class per transaction. Safe to retry.
- Post-publish changes go through the **correction** route only: reason required, version bumped, class re-ranked, audit entry with before and after.
- Public lookup returns one generic "No result found" for a wrong roll, a wrong birth date or an unpublished exam, is rate limited per IP and per school, sends `Cache-Control: no-store`, and exposes no phone, address, guardian or birth registration data.

### 4.5 Files

Nothing is uploaded through the API. The browser uploads directly to Cloudinary using a short-lived signed request from `POST /uploads/sign` (tenant-scoped folder, image formats whitelisted). Stored links must belong to this platform's Cloudinary account, so a client cannot save a link to an arbitrary host.

### 4.6 PDFs

Receipts and marksheets use `pdfkit` with Noto Sans Bengali embedded (`assets/fonts`) for Bangla shaping. The HTML receipt is printable as a fallback.

## 5. Domain modules

Each module lives in `src/app/modules/<name>/`. Complex modules follow the six-file shape (`controller`, `service`, `model`, `interface`, `route`, `validation`); simple lookup tables use the shared `crudRouter` factory in `src/app/lib/crud.ts`.

| Area | Modules |
|---|---|
| Platform | `platform`, `plan`, `tenant`, `slug`, `auditLog`, `counter` |
| Identity | `auth`, `user` |
| Academic | `academicSession`, `class`, `section`, `subject`, `classSubject`, `student`, `guardian`, `enrolment`, `studentImport`, `promotion` |
| HR | `employee`, `designation`, `department`, `teacherAttendance`, `teacherLeave` |
| Routines | `routinePeriod`, `classRoutine`, `examRoutine`, `seatPlan` |
| Accessories | `idCard`, `teacherIdCard`, `admitCard`, `testimonial` |
| Daily operations | `attendance`, `notice`, `publicSite`, `staffProfile`, `inquiry`, `upload`, `publicApi`, `dashboard` |
| Money | `feeHead`, `feeStructure`, `feeAdjustment`, `invoice`, `payment`, `ledger`, `receipt`, `feeReport` |
| Exams | `gradingScale`, `exam`, `marks`, `result`, `marksheet`, `resultReport`, `publicResult` |

To add a module: create the folder, add its model to `src/app/models.ts` (so the isolation guards see it), mount its router in `src/app/routes/index.ts`, and add tests. Use `createTenantSchema` for tenant data; it applies tenant scoping, soft delete and audit stamping.

## 6. API conventions

- Base path `/api/v1`. Success: `{ success: true, data, meta? }`. Error: `{ success: false, code, message, details? }`. Clients localise by `code`.
- Lists paginate with `page` (default 1) and `limit` (default 20, max 100) and return `meta: { page, limit, total }`.
- Dates are `YYYY-MM-DD` in Asia/Dhaka; timestamps are UTC ISO strings. Phone numbers are normalised to `01XXXXXXXXX`.
- `POST /payments` and `POST /invoices/generate` need `Idempotency-Key` (8 to 100 characters). `POST /invoices/generate?dryRun=true` and `POST /students/promote?dryRun=true` preview without writing.
- `POST /auth/refresh` needs the `X-Requested-With` header (CSRF guard) plus the cookie.
- Interactive docs: import `docs/openapi.json` into any OpenAPI viewer. It lists 76 operations with request schemas, allowed roles and the idempotency header, and is regenerated by `npm run docs:api`.

Roles: `superAdmin` (platform console only), `admin`, `teacher`, `accountant`, `student`, `guardian`. The full permission matrix is PRD section 4 and is enforced by `roleGuard` plus ownership checks in services.

## 7. Testing

The suite runs against an **in-memory MongoDB replica set** (`mongodb-memory-server`), so transactions are exercised for real and no database setup is needed. Every test file gets its own database. The tenant isolation checks are a required CI check.

| Layer | Files | What is proven |
|---|---|---|
| Pure logic | `resultEngine`, `libs`, `slug` | GPA table, component pass marks, absent, grace, fourth subject bonus, 5.00 cap, rounding, merit ranking with shared positions, money rounding, Dhaka dates, slug rules. Expected values are hand checked |
| Tenant isolation | `plugins`, `isolation.guard`, `isolation.attack` | Query without context throws; reads, writes, aggregates and `insertMany` are scoped; `.unscoped()` only where allowed; every model is tenant scoped or listed as platform; cross-tenant attacks on users, money, exams and public results fail |
| Identity | `auth.*`, `users`, `platform` | Atomic signup, reserved and duplicate slugs, generic login errors, lockout, refresh rotation and reuse detection, CSRF header, password reset, last-admin guard, suspension rules |
| Academic and daily ops | `academic`, `students`, `studentImport`, `promotion`, `attendance`, `notices`, `publicSite`, `dashboard` | Plan cap, atomic student ids under concurrency, CSV dry run and idempotent commit, promotion preview equals commit, edit windows, audience rules, honeypot, published gate |
| Money | `fees` | Idempotent generation, adjustments, overpayment rejected, simultaneous payments never overpay, reversal restores dues, ledger append-only, ledger consistency job, collection report equals payments minus reversals, Bangla PDF receipt |
| Exams | `exams` | Marks entry scoping, submit and unlock, publish lock, retry safety, audited correction with re-ranking, generic public failures, `no-store` |
| Uploads | `upload` | Cloudinary signature recomputed and verified, tenant folder, account-scoped URLs |
| Performance (opt-in) | `perf` | 2,000 students x 12 subjects publish time and public lookup latency |

```bash
npm test                                          # everything except the opt-in performance gate
npx vitest run tests/fees.test.ts                 # one file
RUN_PERF=1 npx vitest run tests/perf.test.ts      # performance gates
```

**Latest full run** (typecheck, lint, audit, tests): `tsc` clean, ESLint clean, `npm audit` 0 vulnerabilities, **27 test files passed, 151 tests passed**, 1 opt-in performance test skipped. About 3.5 minutes on a laptop.

Performance gates (opt-in, in-memory MongoDB, so a staging run is the real proof): publishing 2,000 students x 12 subjects took **13.9 s** against the 30 s target. The public result lookup target is p95 under 500 ms; one run measured 832 ms but it overlapped with the full test suite, so treat that number as unconfirmed and re-measure on staging.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, the full suite and `npm audit --audit-level=high` on every push and pull request.

## 8. Security

Summarised here; the full review with the rate-limit table is in [`docs/SECURITY.md`](docs/SECURITY.md).

- argon2id, generic login errors, lockout, rotating refresh tokens stored hashed, httpOnly cookies, CSRF header.
- Zod on every route, Mongo operator keys stripped, 1 MB JSON limit, 5 MB and 2,000 row CSV limit.
- Tenant isolation enforced in the data layer and covered by an attack suite.
- Logs carry request id, tenant id and user id only; passwords, tokens, phone numbers and birth registration numbers are redacted.
- Secrets live in the environment only. `.env` is git ignored. Rotate any secret that was ever pasted into a chat or committed.

## 9. Operations

**Deploy.** `docker compose up -d --build` runs the API and a one-node MongoDB replica set. `docker compose --profile proxy up -d` adds Caddy for automatic HTTPS (edit `deploy/Caddyfile` first). For production prefer a managed MongoDB (Atlas replica set) over the bundled container, set `NODE_ENV=production`, and keep the API behind one reverse proxy (`trust proxy` is 1).

**Backups.** `ops/backup.sh` writes a gzipped `mongodump`, optionally encrypted with AES-256 (`BACKUP_PASSPHRASE`), keeps 14 days, and can push off-box through `BACKUP_UPLOAD_CMD`. Schedule it with cron. `ops/restore.sh <file> <target uri>` restores into a clean database and runs `npm run smoke` (collections present, ledger consistent). Run the restore drill monthly and log it. Requires the MongoDB Database Tools on the host.

**Observability.** pino JSON logs, `/api/v1/health` (liveness plus DB ping, no tenant data) for an uptime monitor, optional Sentry via `SENTRY_DSN` (ids only, no personal data), nightly ledger consistency check.

**Results day.** Public lookup is rate limited and cached for 15 seconds at the tenant level. Cached rows are cleared on every write that affects them.

## 10. Decisions and deviations from the PRD

| Topic | Decision | Reason |
|---|---|---|
| SMS and custom domains (PRD phase 6) | Not built | No paid SMS provider; custom domains not needed. The related plan feature flag and platform fields remain harmless |
| Online payments | Not built | Manual collection only in v1, per the PRD. Gateway adapters are v2 |
| Password hashing | argon2id | PRD wins over the `BCRYPT_SALT_ROUND` found in the first `.env` |
| File uploads | Browser to Cloudinary, signed by the API | Free plan is enough and no file bytes pass through the server |
| Background jobs | `node-cron` in process | No Redis to run. One job today (ledger check); move to a queue before adding SMS |
| Owner password rule | 12+ characters in production only | A short dev password must not stop the server booting locally |
| Simple CRUD modules | Shared `crudRouter` factory | Avoids six near-identical files per lookup table |
| Mongoose typing | Models without an interface use `Model<any>` | Mongoose 9 inference was unusable for the dynamic tenant schemas; behaviour is covered by tests instead |

## 11. Known limitations and launch checklist

Limitations to be aware of:

- Madrasa division names and grading rules are starting presets and must be reviewed with a real madrasa teacher. School rules follow the common Bangladesh GPA 5.00 approach and must be confirmed with two or three teachers before the first paying school.
- Bangla PDFs use embedded Noto Sans Bengali and are generated through `pdfkit`. The tests prove valid PDFs are produced; **open one real receipt and one 12-subject marksheet and check conjunct letters visually** before launch.
- Attendance holidays are not modelled (a date is simply not submitted).
- Email delivery has no provider: the forgot-password link is logged in development only. Connect an `EmailProvider` before relying on it.
- The cache and the cron job are per process. Run one API instance, or move both to shared infrastructure before scaling out.
- Backup, restore and Docker files are written and reviewed but need a first real run on the target host.

Before launch (owner tasks):

- [ ] Fill production `.env` with new random secrets; set `UPLOAD_PROVIDER=cloudinary` and the three Cloudinary values.
- [ ] Deploy staging, run the opt-in performance gates against it, then production.
- [ ] Do one backup and one restore drill; schedule `ops/backup.sh`.
- [ ] Add uptime monitoring on `/api/v1/health` and set `SENTRY_DSN`.
- [ ] Write the privacy policy and terms; check current Bangladesh data protection rules (students are minors).
- [ ] Pilot with two real schools for a week.

## 12. Repository layout and conventions

```
server/
  src/
    app.ts, server.ts            app factory and bootstrap
    app/
      config/                    env (Zod) and database
      lib/                       tenantContext, money, localDate, pdf, crud, transaction, csv, ...
      middlewares/               auth, validateRequest, rateLimit, error handler, sanitize
      plugins/                   tenantScoped, softDelete, auditable, createTenantSchema
      modules/<name>/            domain code
      jobs/                      scheduled jobs
      docs/                      OpenAPI generator
      routes/index.ts            all routers mounted here
    scripts/                     seeds, OpenAPI generation, smoke test
  tests/                         Vitest + supertest; helpers in tests/helpers
  ops/                           backup and restore scripts
  deploy/                        Caddyfile
  docs/                          SECURITY.md, openapi.json
  assets/fonts/                  Noto Sans Bengali
```

Conventions: TypeScript strict; the tenant key is always `tenantId` (never `schoolId`); money is integer poisha; business dates are `YYYY-MM-DD` strings; errors are `AppError` with a stable `code`; every state-changing admin action writes an audit entry. Commit messages follow `phase X.Y: what changed` for the build history and conventional prefixes (`fix:`, `docs:`, `test:`, `build:`) for follow-ups.
