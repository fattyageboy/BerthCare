# BerthCare Quick Start Guide

Get BerthCare running locally in under 5 minutes.

## Prerequisites

- **Docker Desktop** installed and running
- **Node.js 20 LTS** installed
- **Git** installed

## Step 1: Clone & Setup (1 minute)

```bash
# Clone the repository
git clone https://github.com/[organization]/berthcare.git
cd berthcare

# One-time setup (copies .env, installs dependencies)
make setup
```

## Step 2: Start Services (2 minutes)

```bash
# Start PostgreSQL, Redis, and LocalStack
make start

# Wait for services to be ready (about 30 seconds)
# Then verify everything is healthy
make verify
```

You should see:

```
✅ Docker is running
✅ PostgreSQL is healthy
   ✅ Databases created (berthcare_dev, berthcare_test)
✅ Redis is healthy
✅ LocalStack is healthy
   ✅ S3 buckets created (photos, documents, signatures)
```

## Step 3: Setup Database (1 minute)

```bash
# Run database migrations
make db-migrate

# Seed with sample data (optional, for development)
make db-seed

# Verify schema
make db-verify
```

You should see:

```
✅ Migration completed successfully
✅ Created 7 sample users
✅ Schema verification successful (12/12 checks passed)
```

## Step 4: Start Backend (1 minute)

```bash
# In a new terminal
cd apps/backend
pnpm run dev
```

You should see:

```
🚀 Backend server running on http://localhost:3000
✅ Connected to PostgreSQL
✅ Connected to Redis
```

## Step 5: Start Mobile App (1 minute)

```bash
# In another new terminal
cd apps/mobile
pnpm start
```

Choose your platform:

- Press `i` for iOS simulator
- Press `a` for Android emulator
- Scan QR code with Expo Go app on your phone

## You're Done! 🎉

Your local development environment is running:

- **Backend API**: http://localhost:3000
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379
- **LocalStack S3**: http://localhost:4566

## Optional: Development Tools

Want database and cache management UIs?

```bash
# Start with development tools
make start-tools
```

Then access:

- **PgAdmin**: http://localhost:5050 (PostgreSQL web UI)
- **Redis Commander**: http://localhost:8081 (Redis web UI)

## Common Commands

```bash
make help          # Show all available commands
make verify        # Check service health
make logs-f        # View real-time logs
make stop          # Stop all services
make restart       # Restart all services

# Database commands
make db-migrate    # Run database migrations
make db-verify     # Verify database schema
make db-seed       # Seed with sample data
make db-shell      # Open PostgreSQL shell
make redis-cli     # Open Redis CLI
```

## Sample Login Credentials (Development Only)

After running `make db-seed`, you can use these credentials:

**Admin:**

- Email: `admin@berthcare.ca`
- Password: `admin123`

**coordinator (North Zone):**

- Email: `coordinator.north@berthcare.ca`
- Password: `coord123`

**Caregiver (North Zone):**

- Email: `caregiver.north1@berthcare.ca`
- Password: `caregiver123`

⚠️ **Never use these passwords in production!**

## Troubleshooting

### Services won't start

```bash
# Check if ports are already in use
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
lsof -i :4566  # LocalStack

# Stop conflicting services or change ports in .env
```

### Docker issues

```bash
# Restart Docker Desktop
# Then try again
make start
```

### Database connection errors

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# View logs
docker-compose logs postgres

# Restart PostgreSQL
docker-compose restart postgres
```

### Need a fresh start?

```bash
# Stop everything and delete all data
make clean

# Start fresh
make start
```

## Next Steps

- Read the [Architecture Documentation](project-documentation/architecture-output.md)
- Review the [Task Plan](project-documentation/task-plan.md)
- Check the [Design System](design-documentation/README.md)
- See [Full Setup Guide](docs/E4-local-setup.md) for detailed information

## Need Help?

- **Technical Issues**: Create a GitHub issue
- **Setup Questions**: Check [docs/E4-local-setup.md](docs/E4-local-setup.md)
- **General Support**: support@berthcare.ca

---

**Happy coding! 🚀**
