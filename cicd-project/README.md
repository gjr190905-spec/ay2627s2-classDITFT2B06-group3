# ST0526 CI/CD Project

A Node.js + Express web application with a full CI/CD pipeline, automated testing, and report publishing to GitHub Pages.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [NPM Scripts](#npm-scripts)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [CI/CD Pipeline](#cicd-pipeline)
- [Reports](#reports)

---

## Project Overview

This project demonstrates a CRUD web application with a complete CI/CD workflow. It includes:

- RESTful API with error handling
- PostgreSQL database with parameterized queries
- Unit, integration, and end-to-end (E2E) tests
- ESLint + Prettier formatting
- CI pipeline with GitHub Actions (lint → test → report → deploy)
- Reports published to GitHub Pages

---

## Tech Stack

| Category       | Tools                        |
| -------------- | ---------------------------- |
| Runtime        | Node.js                      |
| Framework      | Express                      |
| Database       | PostgreSQL (via `pg` driver) |
| Unit Tests     | Jest, Supertest              |
| E2E Tests      | Playwright (Chromium)        |
| Linting        | ESLint, Prettier             |
| CI/CD          | GitHub Actions               |
| Report Hosting | GitHub Pages                 |

---

## Project Structure

```
├── .github/workflows/
│   ├── ci.yml                  # CI pipeline (lint, test, report, pages)
│   └── cd.yml                  # CD pipeline (deployment placeholder)
├── __tests__/
│   ├── unit/                   # Jest unit tests
│   ├── integration/            # Jest + Supertest integration tests
│   └── helpers/cleanup.js      # Deletes test vendors/persons with their kept order history
├── configs/
│   ├── eslint.config.mjs       # ESLint config
│   ├── jest-integration-setup.js
│   ├── playwright.config.js    # Playwright E2E config
│   └── playwright-global-setup.js
├── scripts/
│   ├── qa-report.js             # Combined QA report generator
│   ├── reset.js                # Database schema reset (reads schema.sql)
│   ├── seed.js                 # Database seeding with sample data
│   └── clean-test-results.js   # Cleanup stale test results
├── src/
│   ├── app.js                  # Express app (middleware, routes, error handling)
│   ├── server.js               # Server startup + graceful shutdown
│   ├── controllers/
│   │   ├── Vendor.controller.js # Vendor request validation + responses
│   │   ├── Menu.controller.js  # Menu request validation + responses
│   │   ├── Order.controller.js # Order request validation + responses
│   │   └── Settings.controller.js # Settings + notifications validation + responses
│   ├── models/
│   │   ├── db.js               # PostgreSQL connection pool
│   │   ├── Vendor.model.js     # Vendor lookup + open/close (transaction)
│   │   ├── Menu.model.js       # Menu items, photos, banner, checkout validation
│   │   ├── Order.model.js      # Orders: place, prepare, ready, collect, dashboard figures
│   │   ├── Settings.model.js   # Order limit + notification choices
│   │   ├── Notification.model.js # In-app notifications (rules, list, read, clear)
│   │   ├── Person.model.js     # Person model
│   │   └── Something.model.js  # Something model (full CRUD)
│   ├── routers/
│   │   ├── Vendor.router.js    # /vendors
│   │   ├── Menu.router.js      # /vendors/:vendorId/menu
│   │   ├── Order.router.js     # /vendors/:vendorId/orders
│   │   ├── Settings.router.js  # /vendors/:vendorId/settings and /notifications
│   │   ├── Person.router.js    # GET /persons
│   │   └── Something.router.js # CRUD /somethings
│   └── public/
│       ├── index.html          # Frontend UI
│       ├── index.js            # Frontend JavaScript
│       ├── vendor/home.html    # Vendor home page
│       ├── vendor/menu.html    # Vendor menu management page
│       ├── vendor/dashboard.html # Vendor dashboard: figures, preparation, handover
│       ├── vendor/settings.html # Vendor settings: orders at once, notifications
│       ├── stall.html          # Customer view of a stall's menu (live availability)
│       ├── css/theme.css       # Shared Makan Liao? theme (fonts, colours, buttons)
│       ├── css/vendor-home.css # Vendor home page styles
│       ├── js/vendor-home.js   # Vendor home page logic
│       ├── css/vendor-menu.css, js/vendor-menu.js   # Vendor menu page
│       ├── css/stall-menu.css, js/stall-menu.js     # Customer stall page
│       ├── css/vendor-dashboard.css, js/vendor-dashboard.js # Vendor dashboard
│       ├── css/vendor-settings.css, js/vendor-settings.js   # Vendor settings
│       ├── fonts/              # Patrick Hand + Montserrat (OFL licences included)
│       └── images/vendors/     # Sample vendor logos used by the seed data
├── e2e-tests/                  # Playwright E2E test specs
├── schema.sql                  # Shared branch schema from the Gitmaster (do not edit here)
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** (v22 or later)
- **2 PostgreSQL databases** — one for development, one for testing (e.g. [Neon DB](https://neon.tech))

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd web-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment files

Create two `.env` files in the project root:

**.env.dev** (development)

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<dev-db-name>?sslmode=require
PORT=3000
```

**.env.test** (testing)

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<test-db-name>?sslmode=require
PORT=3001
```

> **Why two databases?** Tests reset the database before each run, so using a separate test database prevents losing your development data.

### 4. Set up the database

```bash
npm run migration:reset
```

This **drops and recreates the `public` schema**, then runs `schema.sql`: the shared branch schema
from the Gitmaster, which is written for a fresh database. Only point `DATABASE_URL` at your own
dev/test databases. `schema.sql` is kept exactly as the Gitmaster gave it; changes to it go through
the Gitmaster, not this branch.

Besides the vendor tables (`Vendor`, `VendorLogo`, `StoreClosure`, `MenuItem`, `MenuItemImage`,
`MenuBanner`, `Order`, `OrderItem`, `VendorSettings`, `VendorNotification`) it creates the shared
ones the other branches use (`FoodCourt`, `PersonCredential`, `Cart`, `CartItem`, `PickupWindow`,
`payments`, `collections`) and the customer branch's views (`users`, `stalls`, `menu_items`,
`pickup_windows`, `orders`, `order_items`). See [Shared schema notes](#shared-schema-notes).

### 5. Seed sample data (optional)

```bash
npm run seed
```

Inserts 20 sample customers, 2 sample somethings, one food court and 4 sample vendors (each with an
owner account in `Person`, role `vendor`), each with a starter menu and sample orders. Today's
orders, in windows around the time you run it, are seeded the way the shared checkout makes them:
a customer, a booked `PickupWindow`, a collection reference and a `payments` row (mostly paid
online, some pending, cancelled ones refunded), in every status including Cancelled. The previous
6 days are collected manual orders for the sales chart. Passwords are not seeded: accounts and
hashes come from the role-access account model.

### 6. Start the server

```bash
npm run start
```

The app runs at `http://localhost:3000` by default.

---

## NPM Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run start`            | Start the dev server (`.env.dev`)        |
| `npm run seed`             | Seed database with sample data           |
| `npm run migration:reset`  | Reset database schema using `schema.sql` |
| `npm run test`             | Run all tests (unit + integration + E2E) |
| `npm run test:unit`        | Run unit tests only                      |
| `npm run test:integration` | Run integration tests only               |
| `npm run test:e2e`         | Run Playwright E2E tests                 |
| `npm run test:trace`       | Run E2E tests with trace recording       |
| `npm run lint`             | Run ESLint                               |
| `npm run lint:fix`         | Auto-fix lint issues                     |
| `npm run lint:report`      | Generate ESLint HTML report              |
| `npm run format`           | Format code with Prettier                |
| `npm run format:check`     | Check formatting without changes         |
| `npm run report`           | Generate full QA report                  |

---

## API Endpoints

### Somethings (CRUD)

| Method   | Endpoint          | Description        | Status Codes |
| -------- | ----------------- | ------------------ | ------------ |
| `POST`   | `/somethings`     | Create a something | 201          |
| `GET`    | `/somethings`     | Get all somethings | 200          |
| `PUT`    | `/somethings/:id` | Update a something | 200, 404     |
| `DELETE` | `/somethings/:id` | Delete a something | 200, 404     |

### Vendors (vendor home and profile pages)

| Method  | Endpoint                   | Description                                                                  | Status Codes       |
| ------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| `GET`   | `/vendors/closure-reasons` | Reasons offered when a vendor closes their stall                             | 200                |
| `GET`   | `/vendors/:id`             | Stall name, logo, open/closed and active status, food court, pickup location | 200, 400, 404      |
| `PATCH` | `/vendors/:id/status`      | Open or close the stall (closing needs a `reason`)                           | 200, 400, 404, 409 |
| `PATCH` | `/vendors/:id/profile`     | Change the shop name (must be unique)                                        | 200, 400, 404, 409 |
| `PUT`   | `/vendors/:id/logo`        | Replace the profile picture (PNG, JPEG or WebP)                              | 200, 400, 404      |
| `GET`   | `/vendors/:id/logo`        | The stored profile picture itself                                            | 200, 400, 404      |

`PATCH /vendors/:id/status` body:

```jsonc
{ "isOpen": true }                                              // open – no reason asked
{ "isOpen": false, "reason": "SOLD_OUT" }                       // close with a listed reason
{ "isOpen": false, "reason": "OTHER", "otherReason": "Gas ran out" } // close with typed reason (1–255 chars)
```

Each close is recorded in the `StoreClosure` table. `409` means the stall is already in the requested state,
or that an admin has deactivated the stall (`isActive = false`), which can't be opened (it can still be closed).

`PUT /vendors/:id/logo` body is `{ "image": "data:image/jpeg;base64,..." }` (max 1 MB). The picture is
stored in the database (`VendorLogo` table, one row per vendor), not as a file in the project.
`logoUrl` then points at `GET /vendors/:id/logo?v=<upload time>`.

The page itself is at `/vendor/home.html`. Until the login page exists, open it as
`/vendor/home.html?vendorId=1` (the id is then kept in `sessionStorage`).

### Menu (vendor menu page, customer stall page, checkout validation)

All routes are under `/vendors/:vendorId/menu`. An item always belongs to the vendor in the address:
another vendor's item id gives `404`.

| Method   | Endpoint                      | Description                                          | Status Codes       |
| -------- | ----------------------------- | ---------------------------------------------------- | ------------------ |
| `GET`    | `/`                           | Stall, banner and every item with its availability   | 200, 400, 404      |
| `POST`   | `/items`                      | Add an item                                          | 201, 400, 404, 409 |
| `GET`    | `/items/:itemId`              | One item                                             | 200, 400, 404      |
| `PATCH`  | `/items/:itemId`              | Change name, description, price and/or quantity left | 200, 400, 404, 409 |
| `DELETE` | `/items/:itemId`              | Delete an item (hidden, kept for order history)      | 204, 400, 404      |
| `PATCH`  | `/items/:itemId/availability` | Switch between Available and Sold out                | 200, 400, 404, 409 |
| `PUT`    | `/items/:itemId/image`        | Replace the item's photo (one per item)              | 200, 400, 404      |
| `DELETE` | `/items/:itemId/image`        | Remove the item's photo                              | 200, 400, 404      |
| `GET`    | `/items/:itemId/image`        | The stored photo itself                              | 200, 400, 404      |
| `PUT`    | `/banner`                     | Replace the menu banner (one per vendor)             | 200, 400, 404      |
| `DELETE` | `/banner`                     | Remove the menu banner                               | 200, 400, 404      |
| `GET`    | `/banner`                     | The stored banner itself                             | 200, 400, 404      |
| `POST`   | `/checkout-check`             | Check a basket before checkout                       | 200, 400, 404, 409 |

```jsonc
// POST /items  (name and price required; price in dollars, up to 2 decimal places)
{ "name": "Mee Siam", "description": "Tangy", "price": "4.50", "quantityLeft": 12 }
// quantityLeft: whole number 0–9999, or null = not counting

// PATCH /items/:itemId/availability
{ "isAvailable": false }

// POST /checkout-check
{ "items": [{ "itemId": 5, "quantity": 2 }] }
// 200 { "ok": true, "items": [...], "totalCents": 1100 }
// 409 { "error": "...", "problems": [{ "itemId": 5, "code": "SOLD_OUT", "message": "..." }] }
//     codes: SOLD_OUT, NOT_ENOUGH, NOT_FOUND (deleted or another stall's), STALL_CLOSED
```

Availability rules:

- Items carry an `isAvailable` flag. The customer page and `/checkout-check` both read it, so a
  vendor's switch takes effect on both straight away.
- Setting `quantityLeft` to `0` marks the item Sold out; setting it above `0` marks it Available
  (restocked). Setting it to `null` (stop counting) leaves the switch as it was.
- An item with `0` left can't be switched to Available (`409`); set how many are left first.
  The database enforces this too (`MenuItem_zero_left_check`).
- Item names are unique per vendor, ignoring case and spaces (`409`). Deleted items don't count.
- Photos and banners use the same rules as the profile picture: base64 data URL, PNG/JPEG/WebP
  checked from the bytes, max 1 MB, stored in the database (`MenuItemImage`, `MenuBanner`).

Pages: the vendor manages the menu at `/vendor/menu.html` (opened from the Menu tile on the
home page). Customers see it at `/stall.html?vendorId=1`; that page rechecks availability every
15 seconds.

### Orders (vendor dashboard: preparation and handover)

All routes are under `/vendors/:vendorId/orders`. Days and "today" are Singapore time. An order
always belongs to the stall in the address: another stall's order id or number gives `404`.

| Method  | Endpoint                 | Description                                               | Status Codes       |
| ------- | ------------------------ | --------------------------------------------------------- | ------------------ |
| `GET`   | `/?date=YYYY-MM-DD`      | The day's orders grouped by pickup window, earliest first | 200, 400, 404      |
| `GET`   | `/stats?date=YYYY-MM-DD` | Dashboard figures (counts, money, on-time rate, charts)   | 200, 400, 404      |
| `GET`   | `/number/:orderNumber`   | Find an order by the number the student shows             | 200, 400, 404      |
| `GET`   | `/:orderId`              | One order                                                 | 200, 400, 404      |
| `POST`  | `/`                      | Place an order (student side)                             | 201, 400, 404, 409 |
| `PATCH` | `/:orderId/status`       | `{ "status": "PREPARING" }` then `{ "status": "READY" }`  | 200, 400, 404, 409 |
| `POST`  | `/:orderId/collect`      | Mark a Ready order Collected                              | 200, 400, 404, 409 |

```jsonc
// POST /  (window 5–120 minutes long, starting between 12 hours ago and 7 days ahead)
{ "customerName": "Alice", "pickupWindowStart": "2026-11-20T04:00:00Z",
  "pickupWindowEnd": "2026-11-20T04:15:00Z", "items": [{ "itemId": 7, "quantity": 2 }] }
// 409 { "error": "...", "problems": [...] }  same codes as /menu/checkout-check

// POST /:orderId/collect – the vendor's three handover checks
{ "orderNumber": 1042, "paymentReceived": true, "foodHandedOver": true }
```

Order rules:

- Statuses go **Confirmed → Preparing → Ready → Collected**, one step at a time. Skipping a step,
  going back, or repeating a step gives `409` (one conditional `UPDATE`, so double clicks are safe).
- Students can cancel an order before it is Ready (the customer branch does this through the shared
  `Order` table). A **Cancelled** order shows on the board under "All", can't be moved on or
  collected (`409`), and is counted in `counts.CANCELLED` but left out of the pickup-window,
  top-item and last-7-days charts.
- `preparingAt`, `readyAt` and `collectedAt` are recorded at each step. Every order carries
  `readyOnTime` (`readyAt <= pickupWindowEnd`), and `/stats` reports the on-time rate.
- Collection needs a **Ready** order of this stall **and** the matching order number, plus
  `paymentReceived` and `foodHandedOver` set to `true`. A second collection gives `409` and changes
  nothing; the database trigger `Order_enforce_status_transition` refuses any change to a collected
  or cancelled order. Collecting also writes the shared `collections` row, recorded against the
  stall owner (`Vendor.ownerUserId`); stalls without an owner account only update `Order`.
- `POST /` places a **manual** order (vendor demo / walk-up): no customer account, pickup window or
  payment row, which the shared schema allows. Students' real orders come through the customer
  branch's checkout (the `orders` / `order_items` views), and show on the dashboard the same way.
- Placing an order locks the stall and item rows, applies the same rules as checkout validation,
  reduces `quantityLeft` (selling out at 0) and assigns the stall's next number (1001, 1002…),
  all in one transaction. Item names and prices are copied into `OrderItem`.
- Every order carries `customerId`, `pickupWindowId`, `collectionReference` (null for manual orders),
  `cancelledAt`, and `payment` (`{ status, method }` from the shared `payments` table, or null).
  When `payment.status` is `PAID`, there is nothing to take at the counter: the handover dialog says
  "Paid online" and ticks the payment check, and `/stats` leaves it out of `toCollectCents`.
- A stall an admin has deactivated is treated as closed (`STALL_CLOSED`), the same as the shared
  checkout path.

Page: `/vendor/dashboard.html` (the Dashboard tile on the home page). It shows today's tiles and
charts, the preparation board grouped by pickup window, and a handover dialog that opens from a
Ready order or from "Find an order". It refreshes every 20 seconds.

### Shared schema notes

How this vendor branch uses the shared schema (`schema.sql`):

- `Vendor.id` is the stall id used in every vendor route; the owner's account is `Vendor.ownerUserId`
  in `Person`. Stalls created without a food court go into the schema's placeholder
  "Vendor Demo" food court (trigger `Vendor_default_foodCourt`).
- `MenuItem` has both spellings: this branch writes `vendorId` / `isSoldOut`, and the
  `MenuItem_sync_aliases` trigger keeps the customer branch's `stallId` / `isAvailable` in step.
- Orders are history: `Order` rows block deleting their vendor or customer. Integration tests use
  `__tests__/helpers/cleanup.js` to delete their own rows in the right order.
- The customer checkout path (`orders` / `order_items` views) does **not** create
  `VendorNotification` rows or check the vendor's "orders at once" limit. Only manual orders placed
  through `POST /vendors/:vendorId/orders` do. Closing that gap needs a change to `schema.sql`, so it
  is raised with the Gitmaster rather than patched here.

### Settings and notifications

| Method   | Endpoint                                    | Description                                   | Status Codes  |
| -------- | ------------------------------------------- | --------------------------------------------- | ------------- |
| `GET`    | `/vendors/:vendorId/settings`               | Settings plus how many orders are in progress | 200, 400, 404 |
| `PUT`    | `/vendors/:vendorId/settings`               | Save all settings                             | 200, 400, 404 |
| `GET`    | `/vendors/:vendorId/notifications`          | Latest 50 notifications and the unread count  | 200, 400, 404 |
| `POST`   | `/vendors/:vendorId/notifications/read-all` | Mark every notification read                  | 200, 400, 404 |
| `DELETE` | `/vendors/:vendorId/notifications`          | Delete all notifications                      | 200, 400, 404 |

```jsonc
// PUT /vendors/:vendorId/settings (every field required)
{
  "maxActiveOrders": 10, // 1–200, or null for no limit
  "notifications": { "newOrder": true, "soldOut": true, "lowStock": true, "lowStockThreshold": 3 },
}
// GET also returns "activeOrders": the orders in progress right now
```

Rules:

- **Orders at once** counts orders that are Confirmed or Preparing. At the limit, placing an
  order and `/menu/checkout-check` give `409` with the problem code `STALL_BUSY`; marking orders
  Ready frees places. The count is read with the stall row locked, so two orders can't both take
  the last place. A vendor with no saved settings has no limit.
- **Notifications** are created in the same transaction as the order, only for the types the
  vendor has switched on: `NEW_ORDER`, `SOLD_OUT` (an order took the last one) and `LOW_STOCK`
  (an order took a counted item down to the threshold or below; told once, when it first
  crosses it).
- Page: `/vendor/settings.html` (the Settings tile). The home page shows the unread count on the
  Settings tile.

### Persons (read-only)

| Method | Endpoint   | Description     | Status Codes |
| ------ | ---------- | --------------- | ------------ |
| `GET`  | `/persons` | Get all persons | 200          |

---

## Testing

### Test Case Design Techniques

| Technique                 | Description                                                           | Used In                |
| ------------------------- | --------------------------------------------------------------------- | ---------------------- |
| Equivalence Partitioning  | Inputs divided into valid and invalid classes, one test per partition | Unit, Integration, E2E |
| Boundary Value Analysis   | Tests at edges of input ranges (e.g. empty string, zero rows, id = 0) | Unit, Integration, E2E |
| Error Handling / Negative | Verifying correct behaviour for invalid inputs and error conditions   | Unit, Integration, E2E |

#### Unit Tests (`__tests__/unit/`)

Tests each model function in isolation with a **mocked database** (`jest.mock`).

| Technique                | Examples                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Valid input (normal string), invalid input (null name, wrong type)                           |
| Boundary Value Analysis  | Empty string (shortest valid input), id = 0, negative id, empty data object (zero fields)    |
| Error Handling           | DB constraint violations, connection timeouts, connection loss — all propagate to the caller |

#### Integration Tests (`__tests__/integration/`)

Tests API endpoints against a **real database** using Supertest.

| Technique                | Examples                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Valid creation (normal name), valid update, valid deletion, data persists after creation |
| Boundary Value Analysis  | Empty table (zero rows), non-existent id (999999)                                        |
| Error Handling           | 404 for missing resources, unknown routes return 404                                     |

#### End-to-End Tests (`e2e-tests/`)

Tests full user workflows in a **real browser** using Playwright.

| Technique                | Examples                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Equivalence Partitioning | Add single item, add multiple items, delete specific item                                       |
| Boundary Value Analysis  | Empty name (HTML5 validation blocks submit), special characters/XSS, delete all until zero rows |
| Error Handling           | Verify other rows unaffected after deletion, input clears after submit                          |

### Software Quality Tools

| Tool           | Purpose                                | How It's Used                                               |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| ESLint         | Static code analysis (linting)         | Catches code errors and enforces coding standards           |
| Prettier       | Code formatting                        | Ensures consistent code style across the project            |
| Jest           | Unit and integration testing framework | Runs tests with mocking, assertions, and coverage reporting |
| Supertest      | HTTP integration testing               | Sends requests to Express routes and asserts responses      |
| Playwright     | End-to-end browser testing             | Automates Chromium to test full user workflows              |
| GitHub Actions | CI/CD automation                       | Runs lint, test, report, and deployment on every push/PR    |

### Test Types

| Type        | Tool             | Location                 | What It Tests                      |
| ----------- | ---------------- | ------------------------ | ---------------------------------- |
| Unit        | Jest             | `__tests__/unit/`        | Models in isolation                |
| Integration | Jest + Supertest | `__tests__/integration/` | API endpoints with a real database |
| E2E         | Playwright       | `e2e-tests/`             | Full user workflows in a browser   |

### Coverage

- Minimum **80%** threshold for branches, functions, lines, and statements
- Coverage reports generated in `coverage-report/`

### Running Tests

```bash
# All tests
npm run test

# Individual test types
npm run test:unit
npm run test:integration
npm run test:e2e
```

---

## CI/CD Pipeline

The CI/CD pipeline runs on every push and pull request to `main`.

### Pipeline Flow

```
Push / PR to main
       │
       ├── lint       (ESLint + Prettier)
       │
       └── test       (unit + integration + E2E)
              │
              │  ── main push only ──
              │
              ├── report   (QA report + artifacts)
              │
              └── pages    (publish reports to GitHub Pages)
```

| Job      | Triggers       | Description                         |
| -------- | -------------- | ----------------------------------- |
| `lint`   | All            | ESLint + Prettier check             |
| `test`   | All            | Unit + integration + E2E            |
| `report` | Main push only | Generate reports + upload artifacts |
| `pages`  | Main push only | Deploy reports to GitHub Pages      |

### Required GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret         | Example Value                                            |
| -------------- | -------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://user:password@host/dbname?sslmode=require` |
| `APP_PORT`     | `3001`                                                   |

### GitHub Pages Setup

1. Go to **Settings → Pages**
2. Set **Source** to **GitHub Actions**
3. Reports will be available at `https://<username>.github.io/<repo>/`

---

## Reports

After running `npm run report`, the following reports are generated:

| Report                         | Description                |
| ------------------------------ | -------------------------- |
| `reports/qa-report.html`       | Combined QA report         |
| `reports/eslint-report.html`   | ESLint lint analysis       |
| `coverage-report/index.html`   | HTML code coverage report  |
| `playwright-report/index.html` | Playwright E2E test report |

On push to `main`, these reports are automatically published to GitHub Pages.
