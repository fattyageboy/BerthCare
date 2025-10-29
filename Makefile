# BerthCare Development Makefile
# Simplifies common development tasks

.PHONY: help setup start stop restart logs clean verify test

# Default target - show help
help:
	@echo "BerthCare Development Commands"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "Setup & Start:"
	@echo "  make setup      - Initial setup (copy .env, install deps)"
	@echo "  make start      - Start all services"
	@echo "  make start-tools - Start services with dev tools (PgAdmin, Redis Commander)"
	@echo "  make stop       - Stop all services"
	@echo "  make restart    - Restart all services"
	@echo ""
	@echo "Development:"
	@echo "  make verify     - Verify all services are healthy"
	@echo "  make logs       - View logs from all services"
	@echo "  make logs-f     - Follow logs in real-time"
	@echo "  make backend    - Start backend in dev mode"
	@echo "  make mobile     - Start mobile app"
	@echo ""
	@echo "Database:"
	@echo "  make db-shell   - Open PostgreSQL shell"
	@echo "  make db-migrate - Run database migrations"
	@echo "  make db-verify  - Verify database schema"
	@echo "  make db-seed    - Seed database with sample data (⚠️  deletes existing data)"
	@echo "  make db-reset   - Reset database (rollback and re-run migrations)"
	@echo "  make db-backup  - Backup database to backup.sql"
	@echo "  make db-restore - Restore database from backup.sql"
	@echo "  make redis-cli  - Open Redis CLI"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean      - Stop services and remove volumes (⚠️  deletes data)"
	@echo "  make reset      - Clean and restart fresh"
	@echo ""

# Initial setup
setup:
	@echo "Setting up BerthCare development environment..."
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅ Created .env file from .env.example"; \
	else \
		echo "⚠️  .env already exists, skipping"; \
	fi
	@echo "Installing dependencies..."
	@pnpm install
	@echo "✅ Setup complete! Run 'make start' to begin."

# Start services
start:
	@echo "Starting BerthCare services..."
	@docker-compose up -d
	@echo "✅ Services started!"
	@echo ""
	@echo "Run 'make verify' to check service health"

# Start with development tools
start-tools:
	@echo "Starting BerthCare services with development tools..."
	@docker-compose --profile tools up -d
	@echo "✅ Services started!"
	@echo ""
	@echo "Development tools available:"
	@echo "  - PgAdmin: http://localhost:5050"
	@echo "  - Redis Commander: http://localhost:8081"

# Stop services
stop:
	@echo "Stopping BerthCare services..."
	@docker-compose down
	@echo "✅ Services stopped"

# Restart services
restart:
	@echo "Restarting BerthCare services..."
	@docker-compose restart
	@echo "✅ Services restarted"

# View logs
logs:
	@docker-compose logs

# Follow logs
logs-f:
	@docker-compose logs -f

# Verify services
verify:
	@./scripts/verify-services.sh

# Start backend
backend:
	@echo "Starting backend in development mode..."
	@cd apps/backend && pnpm run dev

# Start mobile
mobile:
	@echo "Starting mobile app..."
	@cd apps/mobile && pnpm start

# Database shell
db-shell:
	@docker-compose exec postgres psql -U berthcare -d berthcare_dev

# Run migrations
db-migrate:
	@echo "Running database migrations..."
	@cd apps/backend && pnpm run migrate:up
	@echo "✅ Migrations complete"

# Verify schema
db-verify:
	@echo "Verifying database schema..."
	@cd apps/backend && pnpm run db:verify

# Reset database
db-reset:
	@echo "Resetting database..."
	@cd apps/backend && pnpm run db:reset
	@echo "✅ Database reset complete"

# Seed database
db-seed:
	@echo "Seeding database with sample data..."
	@cd apps/backend && pnpm run db:seed

# Backup database
db-backup:
	@echo "Backing up database..."
	@docker-compose exec postgres pg_dump -U berthcare berthcare_dev > backup.sql
	@echo "✅ Database backed up to backup.sql"

# Restore database
db-restore:
	@if [ ! -f backup.sql ]; then \
		echo "❌ backup.sql not found"; \
		exit 1; \
	fi
	@echo "Restoring database from backup.sql..."
	@docker-compose exec -T postgres psql -U berthcare -d berthcare_dev < backup.sql
	@echo "✅ Database restored"

# Redis CLI
redis-cli:
	@docker-compose exec redis redis-cli -a berthcare_redis_password

# Clean (remove volumes)
clean:
	@echo "⚠️  This will delete all data in Docker volumes!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v; \
		echo "✅ Services stopped and volumes removed"; \
	else \
		echo "Cancelled"; \
	fi

# Reset (clean and restart)
reset: clean start
	@echo "✅ Environment reset complete"

# Run tests
test:
	@echo "Running tests..."
	@pnpm run test
