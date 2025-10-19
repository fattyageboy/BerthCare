import { logWarn } from '../config/logger';

const YEAR_IN_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_PAST_OFFSET_MS = 150 * YEAR_IN_MS;
const MAX_FUTURE_OFFSET_MS = 20 * YEAR_IN_MS;

function isWithinWindow(timestamp: number, reference: number): boolean {
  return (
    timestamp >= reference - MAX_PAST_OFFSET_MS &&
    timestamp <= reference + MAX_FUTURE_OFFSET_MS
  );
}

function parseNumericTimestamp(value: number): Date | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const millisecondsCandidate = value;
  const secondsCandidate = value * 1000;

  const millisecondsDate = new Date(millisecondsCandidate);
  const secondsDate = new Date(secondsCandidate);

  const millisecondsValid = !Number.isNaN(millisecondsDate.getTime());
  const secondsValid = !Number.isNaN(secondsDate.getTime());

  const now = Date.now();
  const millisecondsInWindow =
    millisecondsValid && isWithinWindow(millisecondsDate.getTime(), now);
  const secondsInWindow = secondsValid && isWithinWindow(secondsDate.getTime(), now);

  if (millisecondsInWindow && secondsInWindow) {
    const millisecondsDistance = Math.abs(millisecondsDate.getTime() - now);
    const secondsDistance = Math.abs(secondsDate.getTime() - now);
    return millisecondsDistance <= secondsDistance ? millisecondsDate : secondsDate;
  }

  if (millisecondsInWindow) {
    return millisecondsDate;
  }

  if (secondsInWindow) {
    return secondsDate;
  }

  if (millisecondsValid && secondsValid) {
    const millisecondsDistance = Math.abs(millisecondsDate.getTime() - now);
    const secondsDistance = Math.abs(secondsDate.getTime() - now);
    return millisecondsDistance <= secondsDistance ? millisecondsDate : secondsDate;
  }

  if (millisecondsValid) {
    return millisecondsDate;
  }

  if (secondsValid) {
    return secondsDate;
  }

  return null;
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : new Date(time);
  }

  if (typeof value === 'number') {
    return parseNumericTimestamp(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function createLogContext(value: unknown): Record<string, unknown> {
  const context: Record<string, unknown> = {
    valueType: value === null ? 'null' : typeof value,
  };

  if (typeof value === 'string') {
    context.valuePreview = value.length > 100 ? `${value.slice(0, 100)}...` : value;
  } else if (typeof value === 'number') {
    context.value = value;
  }

  return context;
}

export function formatDateTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseDateValue(value);

  if (!parsed) {
    logWarn('formatDateTime: unable to parse value', createLogContext(value));
    return null;
  }

  return parsed.toISOString();
}

export function formatDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseDateValue(value);

  if (!parsed) {
    logWarn('formatDateOnly: unable to parse value', createLogContext(value));
    return null;
  }

  return parsed.toISOString().split('T')[0];
}
