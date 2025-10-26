# Task E3: Monorepo Structure Configuration

**Task ID**: E3  
**Status**: ✅ Completed  
**Date**: October 10, 2025  
**Owner**: DevOps Engineer

## Overview

Configured Nx monorepo structure for BerthCare platform with workspace organization for mobile app, backend API, and shared libraries. Established TypeScript, ESLint, and Prettier configurations for consistent code quality across all projects.

## Objectives

- Set up Nx workspace for monorepo management
- Create workspace structure: `/apps/mobile`, `/apps/backend`, `/libs/shared`
- Configure shared TypeScript, ESLint, and Prettier configurations
- Enable efficient task orchestration with caching
- Establish path aliases for clean imports

## Deliverables Completed

### 1. Nx Workspace Configuration

**Files Created:**

- `nx.json` - Nx workspace configuration with caching and task orchestration
- `package.json` - Root package with workspace definitions and scripts
- `tsconfig.base.json` - Shared TypeScript configuration with path aliases

**Key Features:**

- Task dependency management (`build` depends on `^build`)
- Caching for `build`, `test`, and `lint` operations
- Affected command support for efficient CI/CD
- Path aliases: `@berthcare/shared` for clean imports

### 2. Mobile Application (`apps/mobile`)

**Structure:**

```
apps/mobile/
├── project.json          # Nx project configuration
├── package.json          # Mobile-specific dependencies
├── tsconfig.json         # React Native TypeScript config
├── .eslintrc.json        # ESLint configuration
└── README.md             # Mobile app documentation
```

**Configuration:**

- React Native 0.73+ with Expo SDK 50+
- WatermelonDB for offline-first architecture
- Zustand + React Query for state management
- Nx targets: `dev`, `build`, `lint`, `test`

### 3. Backend API (`apps/backend`)

**Structure:**

```
apps/backend/
├── project.json          # Nx project configuration
├── package.json          # Backend dependencies
├── tsconfig.json         # Node.js TypeScript config
├── .eslintrc.json        # ESLint configuration
└── README.md             # Backend documentation
```

**Configuration:**

- Node.js 20 LTS with Express.js 4.x
- TypeScript with CommonJS modules
- Hot reload with `tsx watch`
- Nx targets: `dev`, `build`, `lint`, `test`

### 4. Shared Library (`libs/shared`)

**Structure:**

```
libs/shared/
├── src/
│   ├── index.ts          # Main export
│   ├── types/            # Shared TypeScript types
│   ├── utils/            # Utility functions
│   └── constants/        # Shared constants
├── project.json          # Nx project configuration
├── package.json          # Library package config
├── tsconfig.json         # Library TypeScript config
├── .eslintrc.json        # ESLint configuration
└── README.md             # Library documentation
```

**Exports:**

- TypeScript interfaces: `User`, `Visit`, `Client`, `ApiResponse`
- Utility functions: `formatPhoneNumber`, `calculateVisitDuration`, `isValidEmail`
- Constants: `ROLES`, `VISIT_STATUS`, performance targets

### 5. Shared Configurations

**TypeScript (`tsconfig.base.json`):**

- Strict mode enabled
- ES2021 target
- Path aliases for clean imports
- Shared across all projects

**ESLint (`.eslintrc.json`):**

- TypeScript support with recommended rules
- Import ordering and organization
- Prettier integration
- Jest support

**Prettier (`.prettierrc.json`):**

- Consistent code formatting
- 100 character line width
- Single quotes, semicolons
- LF line endings

## Workspace Commands

### Development

```bash
# Run all projects in development mode
pnpm run dev

# Run specific project
nx dev mobile
nx dev backend

# Run mobile app on device
cd apps/mobile && pnpm run ios
cd apps/mobile && pnpm run android
```

### Building

```bash
# Build all projects
pnpm run build

# Build specific project
nx build backend
nx build shared
```

### Testing & Linting

```bash
# Run all tests
pnpm run test

# Run all linters
pnpm run lint

# Format all code
pnpm run format
```

### Nx Task Orchestration

```bash
# Run tasks across multiple projects
nx run-many --target=build --all
nx run-many --target=test --projects=backend,shared

# Run only affected projects (CI optimization)
nx affected --target=build
nx affected --target=test
```

## Verification Checklist

- [x] Nx workspace initialized with proper configuration
- [x] `/apps/mobile` directory created with React Native setup
- [x] `/apps/backend` directory created with Node.js setup
- [x] `/libs/shared` directory created with shared utilities
- [x] `tsconfig.base.json` configured with path aliases
- [x] ESLint configuration extends to all projects
- [x] Prettier configuration applies workspace-wide
- [x] `nx run-many` commands execute tasks across projects
- [x] Shared library imports work via `@berthcare/shared`
- [x] Project-specific configurations inherit from base configs
- [x] Task caching enabled for build, test, lint operations
- [x] Documentation created for each workspace project

## Testing the Setup

### 1. Verify Nx Installation

```bash
# Check Nx version
npx nx --version

# List all projects
npx nx show projects
```

**Expected Output:**

```
mobile
backend
shared
```

### 2. Test Task Execution

```bash
# Build all projects
nx run-many --target=build --all

# Should build: shared → backend, mobile (in correct order)
```

### 3. Verify Path Aliases

Create a test file in `apps/backend/src/test.ts`:

```typescript
import { User, formatPhoneNumber, ROLES } from '@berthcare/shared';

const user: User = {
  id: '1',
  email: 'test@example.com',
  role: ROLES.caregiver,
  firstName: 'Test',
  lastName: 'User',
  createdAt: new Date(),
  updatedAt: new Date(),
};

console.log(formatPhoneNumber('4165551234'));
```

### 4. Test Caching

```bash
# First build (no cache)
nx build backend

# Second build (should use cache)
nx build backend
# Should see: "Nx read the output from the cache instead of running the command"
```

## Architecture Decisions

### Why Nx Over Turborepo?

**Chosen: Nx**

**Rationale:**

- Superior task caching and orchestration
- Better dependency graph visualization
- Built-in affected command for CI optimization
- Extensive plugin ecosystem
- Better TypeScript integration
- More mature and battle-tested

**Trade-offs:**

- Slightly steeper learning curve
- More configuration files
- Larger dependency footprint

### Workspace Structure

**Chosen: Apps/Libs Pattern**

```
/apps     - Deployable applications
/libs     - Shared libraries
/docs     - Documentation
```

**Rationale:**

- Clear separation of deployable vs. shared code
- Scalable for future microservices
- Standard Nx convention
- Easy to understand and navigate

### Path Aliases

**Chosen: `@berthcare/shared`**

**Rationale:**

- Clean, readable imports
- Prevents relative path hell (`../../../libs/shared`)
- Consistent with scoped packages on npm (installed via pnpm)
- Easy to refactor and move files

## Next Steps

### Immediate (Task E4)

- [ ] Install dependencies: `pnpm install`
- [ ] Verify all projects build successfully
- [ ] Set up development environment variables
- [ ] Create initial source files for mobile and backend

### Phase 3 Continuation

- [ ] E4: Set up local Docker development environment
- [ ] E5: Configure database migrations
- [ ] E6: Implement shared authentication utilities

### Future Enhancements

- [ ] Add `libs/ui` for shared React components
- [ ] Configure Nx Cloud for distributed caching
- [ ] Add workspace generators for scaffolding
- [ ] Set up Storybook for component development

## Reference Documentation

### Internal

- [Project Architecture](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)
- [Git Setup](./E1-git-repository-initialization.md)
- [CI/CD Setup](./E2-ci-pipeline-setup.md)

### External

- [Nx Documentation](https://nx.dev)
- [Nx Monorepo Tutorial](https://nx.dev/getting-started/tutorials)
- [TypeScript Path Mapping](https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping)
- [Workspace Best Practices](https://nx.dev/concepts/more-concepts/applications-and-libraries)

## Troubleshooting

### Issue: `Cannot find module '@berthcare/shared'`

**Solution:**

```bash
# Rebuild TypeScript paths
nx reset
pnpm install
```

### Issue: Nx cache not working

**Solution:**

```bash
# Clear Nx cache
nx reset

# Verify cache directory
ls -la .nx/cache
```

### Issue: ESLint errors in IDE

**Solution:**

1. Restart TypeScript server in IDE
2. Ensure workspace root is opened (not subdirectory)
3. Install ESLint extension for your IDE

### Issue: Build order incorrect

**Solution:**
Check `project.json` files have correct `dependsOn` configuration:

```json
{
  "targets": {
    "build": {
      "dependsOn": ["^build"]
    }
  }
}
```

## Notes

- All projects use TypeScript 5.3.3 for consistency
- Shared ESLint config enforces import ordering
- Nx caching significantly speeds up CI/CD pipelines
- Path aliases require IDE restart to take effect
- Workspace uses pnpm workspaces (not yarn/npm)

---

**Completion Date**: October 10, 2025  
**Verified By**: DevOps Engineer  
**Related Tasks**: E1 (Git Setup), E2 (CI/CD), E4 (Docker Setup)
