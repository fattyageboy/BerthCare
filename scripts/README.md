# BerthCare Scripts

Utility scripts for local development and deployment.

## Local Development Scripts

### verify-services.sh

Verifies that all local development services are running and healthy.

```bash
./scripts/verify-services.sh
```

**Checks:**

- Docker is running
- PostgreSQL is healthy and databases are created
- Redis is healthy and accepting connections
- LocalStack is healthy and S3 buckets are created

### init-db.sql

PostgreSQL initialization script that runs automatically when the database container starts for the first time.

**Creates:**

- `berthcare_dev` database (main development database)
- `berthcare_test` database (for running tests)
- UUID extension (for generating unique identifiers)
- Health check tables

**Usage:** Automatically executed by Docker Compose, no manual intervention needed.

### init-localstack.sh

LocalStack initialization script that runs automatically when LocalStack is ready.

**Creates:**

- S3 buckets: `berthcare-photos-dev`, `berthcare-documents-dev`, `berthcare-signatures-dev`
- Enables versioning on all buckets
- Configures CORS for local development

**Usage:** Automatically executed by Docker Compose, no manual intervention needed.

## Deployment Scripts

### setup-monitoring.sh

Configures monitoring and observability tools (CloudWatch, Sentry).

```bash
./scripts/setup-monitoring.sh
```

**See:** [E6: Monitoring & Observability Setup](../docs/E6-monitoring-observability-setup.md)

### setup-twilio-secrets.sh

Interactive script to store Twilio credentials in AWS Secrets Manager.

```bash
./scripts/setup-twilio-secrets.sh
```

**Features:**

- Interactive prompts for Twilio credentials
- Support for staging and production environments
- Automatic secret creation/update in AWS Secrets Manager
- Secret verification after creation
- Proper tagging for organization

**Prerequisites:**

- AWS CLI configured with appropriate credentials
- Twilio account with subaccounts created
- Phone numbers purchased

**See:** [E7: Twilio Setup](../docs/E7-twilio-setup.md)

## Usage

All scripts are automatically executed by Docker Compose. You don't need to run them manually unless you're troubleshooting.

### Manual Execution

If you need to manually run a script:

```bash
# Make script executable (if not already)
chmod +x scripts/verify-services.sh

# Run the script
./scripts/verify-services.sh
```

### Troubleshooting

If initialization scripts fail:

```bash
# Check Docker logs
docker-compose logs postgres
docker-compose logs localstack

# Manually run database initialization
docker-compose exec postgres psql -U berthcare -d berthcare_dev -f /docker-entrypoint-initdb.d/init-db.sql

# Manually run LocalStack initialization
docker-compose exec localstack sh /etc/localstack/init/ready.d/init-localstack.sh
```

## Adding New Scripts

When adding new scripts:

1. Create the script in this directory
2. Make it executable: `chmod +x scripts/your-script.sh`
3. Add documentation to this README
4. Include error handling and clear output messages
5. Test thoroughly before committing

---

**Last Updated:** October 10, 2025
