#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

// Allowlist semantics:
// - Entries may be GHSA identifiers (preferred), npm advisory numbers, or package names when npm audit omits a stable ID.
// - Package-level entries suppress every advisory for that dependency; keep them temporary and revisit quickly after upstream patches.
// Ownership: Mobile platform maintainers review this list monthly and before each major release.
// TODO: Replace remaining package-level entries as soon as upstream publishes concrete advisories or fixes.
// Update entries directly in scripts/check-mobile-audit.mjs when new findings need to be acknowledged.
const ALLOWLIST = new Set([
  'GHSA-968p-4wvh-cqc8', // Accepted risk: @babel/runtime ReDoS; only executed in build tooling, tracked for next Babel upgrade.
  'GHSA-pxg6-pf52-xh8x', // cookie header parsing issue; limited to Expo dev server usage, no production exposure.
  '@expo/image-utils', // Package-level: bundled CLI helper; wait for Expo SDK to consume patched sharp dependency.
  '@expo/prebuild-config', // Package-level: CLI-only; pending Expo release to pick up fixed json schema dependency.
  '@expo/server', // Package-level: dev-mode server; risk limited to local tooling, monitor Expo security advisories.
  'expo-splash-screen', // Package-level: Expo-managed native module flagged for optional dependency; awaiting Expo SDK patch.
  'expo-router', // Package-level: Expo router dev dependency; mitigated by internal navigation validation.
  '@expo/cli', // Package-level: Base CLI bringing the above transitives; track Expo CLI release notes for security fixes.
  '@react-native-community/cli', // Package-level: required by Expo build process; review React Native CLI changelog monthly.
  '@react-native-community/cli-doctor', // Package-level: invoked by diagnostics only; no production usage.
  '@react-native-community/cli-hermes', // Package-level: Hermes tooling; risk bounded to local builds.
  'send', // Package-level: Express send helper used by Expo dev server; follow Express security advisories for removal.
  'react-native', // Package-level: legacy vulnerability on Android asset loader; upgrade planned with next RN LTS roll-out.
  '1101851', // npm advisory 1101851 (ip); CLI-only path validation, sanitized by input constraints.
  '1101088', // npm advisory 1101088 (semver); only evaluated during version resolution in tooling.
]);

const auditArgs = ['audit', '--omit=dev', '--workspace=@berthcare/mobile', '--json'];
const result = spawnSync('npm', auditArgs, { encoding: 'utf-8' });

if (result.error) {
  console.error('Failed to run npm audit:', result.error);
  process.exit(1);
}

const output = result.stdout?.trim();

if (!output) {
  console.error('npm audit did not return JSON output.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(output);
} catch (err) {
  console.error('Unable to parse npm audit output as JSON:', err);
  console.error('Raw output:', output);
  process.exit(1);
}

const vulnerabilities = report?.vulnerabilities ?? {};
const highSeverityFindings = [];

for (const [pkgName, info] of Object.entries(vulnerabilities)) {
  const severity = info?.severity?.toLowerCase();
  if (!severity || (severity !== 'high' && severity !== 'critical')) {
    continue;
  }

  const viaEntries = Array.isArray(info?.via) ? info.via : [];
  const sources = viaEntries
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return String(item);
      }
      if (item && typeof item === 'object') {
        const source = item.source ?? item.url ?? item.title ?? null;
        return source != null ? String(source) : null;
      }
      return null;
    })
    .filter(Boolean);

  const nonAllowlistedSources = sources.filter((source) => !ALLOWLIST.has(source));

  if (nonAllowlistedSources.length > 0) {
    highSeverityFindings.push({
      package: pkgName,
      severity,
      sources: nonAllowlistedSources,
    });
  }
}

if (highSeverityFindings.length > 0) {
  console.error('High severity vulnerabilities detected outside the allowlist:');
  for (const finding of highSeverityFindings) {
    console.error(`- ${finding.package} (${finding.severity}): ${finding.sources.join(', ')}`);
  }

  process.exit(1);
}

console.log('npm audit passed: only allowlisted vulnerabilities detected (if any).');
process.exit(0);
