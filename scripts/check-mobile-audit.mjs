#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const ALLOWLIST = new Set([
  'GHSA-968p-4wvh-cqc8', // @babel/runtime inefficient RegExp
  'GHSA-pxg6-pf52-xh8x', // cookie out-of-bounds characters
  '@expo/image-utils', // transitively pulled via Expo CLI
  '@expo/prebuild-config',
  '@expo/server',
  'expo-splash-screen',
  'expo-router',
  '@expo/cli',
  '@react-native-community/cli',
  '@react-native-community/cli-doctor',
  '@react-native-community/cli-hermes',
  'send', // inherited via Expo CLI
  'ip', // vulnerability advisory 1101851
  'semver', // vulnerability advisory 1101088
  'react-native',
  '1101851',
  '1101088',
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
