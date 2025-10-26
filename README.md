# BerthCare - Home Care Management Platform

**Version:** 1.0.0  
**Philosophy:** Simplicity is the ultimate sophistication

## Overview

BerthCare is a mobile-first home care management platform designed to make technology invisible for caregivers and caregivers. Built on the principle that "if users need a manual, the design has failed," BerthCare enables seamless offline-first visit documentation, care coordination, and family communication.

### Core Features

- **Offline-First Visit Documentation**: Work anywhere, sync automatically
- **Smart Data Reuse**: Pre-fill from previous visits, edit what changed
- **Voice-First Care Coordination**: One-tap alerts to coordinators
- **SMS Family Portal**: Daily updates with 98% open rate
- **GPS Auto Check-In/Out**: No manual entry required
- **Auto-Save Everything**: No save buttons, no data loss

### Design Philosophy

> "Start with the user experience, then work backwards to the technology."

- **Simplicity is the ultimate sophistication**: One app, one database pattern, one communication method
- **The best interface is no interface**: Auto-save, auto-sync, auto-everything
- **Obsess over every detail**: Sub-100ms response times, <2 second app launch
- **Say no to 1,000 things**: Focus on core workflows, eliminate feature bloat

## Technology Stack

### Mobile Application

- **Framework**: React Native 0.73+ with Expo SDK 50+
- **Local Database**: WatermelonDB (SQLite) for offline-first architecture
- **State Management**: Zustand + React Query

### Backend Services

- **Runtime**: Node.js 20 LTS with Express.js 4.x
- **Database**: PostgreSQL 15+ (ACID compliance)
- **Cache**: Redis 7+ (sessions, API caching)
- **Storage**: AWS S3 (photos, documents)

### Communication

- **Voice Calls**: Twilio Voice API
- **SMS**: Twilio SMS API
- **Push Notifications**: Expo Push Notifications

### Infrastructure

- **Cloud Provider**: AWS (Canadian data residency - ca-central-1)
- **Compute**: ECS Fargate (serverless containers)
- **CDN**: CloudFront
- **Monitoring**: CloudWatch + Sentry

## Project Structure

```
berthcare/
├── apps/
│   ├── mobile/              # React Native mobile app
│   └── backend/             # Node.js API server
├── libs/
│   └── shared/              # Shared utilities and types
├── design-documentation/    # UX/UI design system
├── project-documentation/   # Architecture and planning
├── terraform/               # Infrastructure as Code
├── .github/                 # CI/CD workflows
└── docs/                    # Technical documentation
```

## Getting Started

### Prerequisites

- Node.js 20 LTS
- Docker & Docker Compose
- Git
- AWS CLI (for deployment)

### Local Development

```bash
# Clone the repository
git clone https://github.com/[organization]/berthcare.git
cd berthcare

# Install dependencies
pnpm install

# Start local development environment
docker-compose up --build

# Run mobile app (in separate terminal)
cd apps/mobile
pnpm run ios    # or pnpm run android
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Edit .env with your local configuration
```

## Documentation

- **Architecture**: [project-documentation/architecture-output.md](project-documentation/architecture-output.md)
- **MVP Scope**: [project-documentation/mvp.md](project-documentation/mvp.md)
- **Task Plan**: [project-documentation/task-plan.md](project-documentation/task-plan.md)
- **Design System**: [design-documentation/](design-documentation/)

## Development Workflow

### Branch Protection

- `main` branch requires:
  - 1+ code review approvals
  - All status checks passing
  - Signed commits
  - No force pushes

### Code Review

See [CODEOWNERS](CODEOWNERS) for automatic reviewer assignments.

### CI/CD Pipeline

- **On PR**: Lint, test, build validation
- **On merge to main**: Deploy to staging
- **On release tag**: Deploy to production

## Security & Compliance

- **Data Residency**: All data stored in AWS ca-central-1 (Canada)
- **Compliance**: PIPEDA, PHIPA compliant
- **Encryption**: End-to-end encryption for all sensitive data
- **Audit Trails**: Comprehensive logging for all operations

## Performance Targets

- **App Launch**: <2 seconds
- **UI Response**: <100ms
- **Auto-Save**: <1 second
- **Background Sync**: <30 seconds
- **Alert Delivery**: <15 seconds

## Contributing

1. Create feature branch from `main`
2. Make changes following code style guidelines
3. Write tests for new functionality
4. Submit PR with clear description
5. Address review feedback
6. Merge after approval

## License

See [LICENSE](LICENSE) for details.

## Support

- **Technical Issues**: Create GitHub issue
- **Security Issues**: security@berthcare.ca
- **General Questions**: support@berthcare.ca

---

**Built with ❤️ for caregivers and caregivers**
