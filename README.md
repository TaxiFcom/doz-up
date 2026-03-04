# DOZ UP — Cloud Screenshot Capture & Sharing Platform
### منصة DOZ UP - التقاط ومشاركة لقطات الشاشة سحابياً

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?logo=stripe&logoColor=white)](https://stripe.com)
[![Jest](https://img.shields.io/badge/Tested%20with-Jest-C21325?logo=jest&logoColor=white)](https://jestjs.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

DOZ UP is a cloud-based screenshot capture and sharing platform. Users and teams can upload, organize, and share screenshots with fine-grained access control, subscription-based storage tiers, and instant shareable links — all through a REST API.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Environment Variables](#environment-variables)
6. [Database Setup](#database-setup)
7. [Running the Application](#running-the-application)
8. [Project Structure](#project-structure)
9. [API Endpoints](#api-endpoints)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [License](#license)

---

## Features

- **Screenshot Upload** — Upload PNG, JPEG, or WebP screenshots with metadata (title, description, tags, visibility).
- **Cloud Storage** — Screenshots stored in S3-compatible object storage with CDN distribution.
- **Shareable Links** — Generate public or password-protected share links with optional expiry and view-count limits.
- **Folder Organization** — Organize screenshots into folders.
- **Subscription Plans** — Free, Pro, Business, and Enterprise tiers powered by Stripe billing.
- **Role-Based Access Control** — `user`, `admin`, and `superadmin` roles with per-endpoint enforcement.
- **Input Validation** — Every endpoint validated with Zod schemas; returns structured 422 field-level errors.
- **CSRF Protection** — Stateless double-submit cookie pattern; webhook paths automatically bypassed.
- **Rate Limiting** — Per-IP and per-user limiting backed by Redis.
- **Audit Logging** — All administrative actions recorded with actor, target, and timestamp.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 LTS |
| Framework | Express 4 |
| ORM | Prisma 5 (PostgreSQL) |
| Cache / Rate Limiting | Redis 7 (ioredis) |
| Payments | Stripe |
| File Storage | AWS S3 / Cloudflare R2 |
| Validation | Zod |
| Password Hashing | bcrypt |
| Email | Nodemailer + SMTP |
| Testing | Jest |
| Process Manager | PM2 |

---

## Prerequisites

- **Node.js** ≥ 18.x ([nodejs.org](https://nodejs.org))
- **npm** ≥ 9.x (bundled with Node.js)
- **PostgreSQL** ≥ 14 ([postgresql.org](https://www.postgresql.org))
- **Redis** ≥ 7 ([redis.io](https://redis.io))
- **Git**

Optional for production:
- Docker & Docker Compose
- PM2 (`npm install -g pm2`)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/doz-up.git
cd doz-up

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env

# 4. Edit .env with your values
nano .env

# 5. Generate Prisma client
npx prisma generate

# 6. Run database migrations
npx prisma migrate deploy

# 7. (Optional) Seed initial data
npx prisma db seed
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in each value. Never commit `.env` to version control.

### Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | `development`, `test`, or `production` |
| `PORT` | No | `3000` | HTTP port the server listens on |
| `BASE_URL` | Yes | — | Full public URL, e.g. `https://up.doz.com` |

### Authentication

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Minimum 32-character secret for signing tokens. Use a random 64-char string in production. |

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string: `postgresql://user:pass@host:5432/dozup_db` |

### Redis

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Yes | Redis connection string: `redis://localhost:6379` |

### Stripe

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Webhook signing secret from the Stripe dashboard |

### Storage (S3-compatible)

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | Yes | Bucket name |
| `S3_REGION` | Yes | Storage region, e.g. `eu-west-1` |
| `S3_ACCESS_KEY` | Yes | Storage access key |
| `S3_SECRET_KEY` | Yes | Storage secret key |

### Email

| Variable | Required | Description |
|---|---|---|
| `SMTP_HOST` | Yes | SMTP server hostname |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | Yes | SMTP username |
| `SMTP_PASS` | Yes | SMTP password |

---

## Database Setup

DOZ UP uses Prisma for database management.

```bash
# Apply all pending migrations (production-safe)
npx prisma migrate deploy

# Create a new migration during development
npx prisma migrate dev --name describe_your_change

# Reset and re-seed the development database
npx prisma migrate reset

# Open Prisma Studio (visual data browser)
npx prisma studio
```

---

## Running the Application

### Development

```bash
npm run dev
# API available at http://localhost:3000
```

### Production

```bash
npm start

# Or with PM2 (recommended)
pm2 start ecosystem.config.js --env production
```

---

## Project Structure

```
doz-up/
├── gateway.js                  # Express app entry point
├── server.js                   # HTTP server bootstrap
├── jest.config.js              # Jest configuration
├── ecosystem.config.js         # PM2 deployment config
├── .env.example                # Environment variable template
├── src/
│   ├── config/
│   │   ├── env.js              # Environment variable loader
│   │   └── index.js            # Merged config object
│   ├── middleware/
│   │   ├── auth.js             # JWT authentication (requireAuth, requireAdmin, optionalAuth)
│   │   ├── validate.js         # Zod validation middleware
│   │   ├── csrf.js             # Double-submit cookie CSRF protection
│   │   ├── async-wrap.js       # Async error propagation helper
│   │   ├── cookie-config.js    # Shared cookie options
│   │   ├── security-headers.js # HTTP security headers
│   │   └── upload-limiter.js   # Multer file-size limits
│   ├── routes/
│   │   └── index.js            # Route registrations
│   ├── validators/             # Zod schemas per domain
│   │   ├── auth.js
│   │   ├── gallery.js
│   │   ├── share.js
│   │   ├── upload.js
│   │   ├── payment.js
│   │   ├── admin.js
│   │   └── common.js
│   └── utils/
│       └── logger.js           # Pino logger
├── services/                   # Business logic services
│   ├── security.js             # JWT / token management
│   ├── admin.js                # Admin session management
│   ├── payments.js             # Stripe integration
│   ├── notifications.js        # Email notifications
│   └── ...                     # Additional domain services
├── tests/
│   ├── setup.js                # Jest environment setup (NODE_ENV, JWT_SECRET, console mocks)
│   ├── helpers.js              # Shared utilities: createMockRequest, createMockResponse,
│   │                          #   createMockNext, generateTestToken
│   └── middleware/
│       ├── auth.test.js        # requireAuth, requireAdmin, optionalAuth
│       ├── validate.test.js    # Zod validation middleware (body, query, coerce, shorthands)
│       └── csrf.test.js        # CSRF protection and cookie middleware
└── .github/
    └── workflows/
        └── test.yml            # CI pipeline (Node 18 × Node 20 matrix)
```

---

## API Endpoints

All endpoints are prefixed with `/api`. Authentication uses Bearer tokens in the `Authorization` header.

```
Authorization: Bearer <token>
```

### Authentication — `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | No | Register a new account |
| `POST` | `/login` | No | Log in, receive access token |
| `POST` | `/logout` | Yes | Revoke the current session |
| `POST` | `/refresh` | No | Refresh an expired access token |
| `POST` | `/forgot-password` | No | Request a password reset email |
| `POST` | `/reset-password` | No | Reset password using emailed token |

### Screenshots — `/api/screenshots`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Yes | List screenshots (filterable, paginated) |
| `POST` | `/` | Yes | Upload a screenshot file |
| `GET` | `/:id` | Yes | Get screenshot details |
| `PATCH` | `/:id` | Yes | Update screenshot metadata |
| `DELETE` | `/:id` | Yes | Delete a screenshot |
| `GET` | `/:id/download` | Yes | Download the original file |

### Share Links — `/api/shares`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/` | Yes | Create a share link |
| `GET` | `/` | Yes | List your share links |
| `GET` | `/:slug` | No | View a shared screenshot |
| `POST` | `/:slug/verify` | No | Submit password for protected links |
| `DELETE` | `/:id` | Yes | Revoke a share link |

### Payments — `/api/payments`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/plans` | No | List available subscription plans |
| `POST` | `/subscribe` | Yes | Create a subscription |
| `POST` | `/subscription/cancel` | Yes | Cancel subscription |
| `GET` | `/invoices` | Yes | List billing invoices |
| `POST` | `/webhook` | No | Stripe webhook receiver (raw body) |

### Admin — `/api/admin`

> Requires `admin` or `superadmin` role.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/users` | admin | List all users |
| `PATCH` | `/users/:id` | admin | Update user data |
| `PUT` | `/users/:id/role` | superadmin | Assign a role |
| `POST` | `/users/:id/suspend` | admin | Suspend a user account |
| `DELETE` | `/users/:id` | superadmin | Delete a user |
| `GET` | `/screenshots` | admin | Browse all screenshots |
| `GET` | `/audit-logs` | admin | View audit trail |
| `GET` | `/stats` | admin | Platform-wide statistics |

### Miscellaneous

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Health check (DB + Redis status) |
| `GET` | `/auth/csrf-token` | No | Fetch a CSRF token for browser clients |

---

## Testing

DOZ UP uses **Jest** for unit and integration tests.

### Quick Start

```bash
# Install test dependencies first (if not already present)
npm install --save-dev jest

# Run all tests
npm test

# Watch mode during development
npm run test:watch

# Coverage report (outputs to ./coverage/)
npm run test:coverage
```

> Add the following scripts to `package.json` if they are not already present:
> ```json
> "test":          "jest",
> "test:watch":    "jest --watch",
> "test:coverage": "jest --coverage"
> ```

### Test Structure

```
tests/
├── setup.js               # Runs before each test file — pins NODE_ENV, mocks console
├── helpers.js             # Shared utilities: createMockRequest, createMockResponse,
│                          #   createMockNext, generateTestToken
└── middleware/
    ├── auth.test.js       # requireAuth, requireAdmin, optionalAuth
    ├── validate.test.js   # Zod validation middleware (body, query, coerce, shorthands)
    └── csrf.test.js       # CSRF protection, cookie middleware, webhook bypass
```

### Writing New Tests

1. Import helpers from `tests/helpers.js`.
2. Use `createMockRequest(overrides)` to build a minimal Express `req`.
3. Use `createMockResponse()` to get a spy-enabled `res` with chainable `status()`.
4. Use `generateTestToken(payload)` to produce a token the security service will accept.

```js
'use strict';

const { createMockRequest, createMockResponse, createMockNext, generateTestToken }
  = require('../helpers');

// Mock services before requiring the middleware
jest.mock('../../services/security', () => ({ verifyToken: jest.fn() }));

const { requireAuth } = require('../../src/middleware/auth');

test('rejects requests without a token', () => {
  const req  = createMockRequest();
  const res  = createMockResponse();
  const next = createMockNext();

  requireAuth(req, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});
```

### Coverage Thresholds

Jest is configured to enforce **50% minimum** across branches, functions, lines, and statements. The CI pipeline will fail if coverage drops below this floor.

---

## Deployment

### Using PM2 (Recommended)

```bash
# First-time start
pm2 start ecosystem.config.js --env production

# Save the process list so it survives reboots
pm2 save

# Set up auto-start on system boot
pm2 startup

# Zero-downtime reload after a new deployment
pm2 reload dozup-api --update-env

# View logs
pm2 logs dozup-api

# Monitor CPU / memory
pm2 monit
```

### Using Docker

```bash
# Start all services (API + PostgreSQL + Redis)
docker compose up -d

# Apply migrations inside the container
docker compose exec api npx prisma migrate deploy

# View logs
docker compose logs -f api
```

### Production Checklist

- [ ] `NODE_ENV=production` is set.
- [ ] All `*.env` files are excluded from the repository (`.gitignore`).
- [ ] `JWT_SECRET` is a random 64-character string.
- [ ] Stripe keys use live mode (`sk_live_…`) and the webhook secret is updated.
- [ ] PostgreSQL and Redis are not publicly accessible (firewall rules).
- [ ] HTTPS is enforced via a reverse proxy (nginx / Caddy / Cloudflare).
- [ ] Rate limiting is tuned for your expected traffic.
- [ ] Log rotation is configured.
- [ ] PostgreSQL backups are scheduled (daily minimum).

---

## License

This project is licensed under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2026 DOZ UP

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
