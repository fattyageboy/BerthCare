# BerthCare Backend API

Node.js 20 LTS backend service with Express.js.

## Features

- RESTful API for mobile app
- PostgreSQL database integration
- Redis caching layer
- Twilio integration for SMS/Voice
- AWS S3 for file storage

## Development

```bash
# Start development server with hot reload
nx dev backend

# Build for production
nx build backend

# Run production build
npm start
```

## Database Migrations

Apply all pending migrations (default behavior):

```bash
npm run migrate:up

# Explicit targets
npm run migrate:up -- all   # run everything pending
npm run migrate:up -- 5     # run the next 5 migrations
npm run migrate:up -- #100  # run through migration code 100
npm run migrate:up -- m100  # alternative prefix for code targets

# Roll back changes
npm run migrate:down -- 1    # roll back the latest migration
npm run migrate:down -- #100 # roll back through migration code 100
```

## Tech Stack

- Node.js 20 LTS
- Express.js 4.x
- PostgreSQL 15+
- Redis 7+
- TypeScript 5.x
