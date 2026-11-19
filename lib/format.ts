import type { Numeric, PropertyType } from './types';

export function toNumber(value: Numeric | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatINR(value: Numeric | null | undefined): string {
  const amount = toNumber(value);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(2)}`;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function freshnessLabel(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'Recently posted';
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return 'Posted just now';
  if (minutes < 60) return `Posted ${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Posted ${days} day${days === 1 ? '' : 's'} ago`;
  return formatDateTime(value);
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function propertyTypeLabel(type: PropertyType): string {
  switch (type) {
    case 'HOUSE': return 'House';
    case 'FLAT': return 'Flat';
    case 'SHOP': return 'Shop';
    case 'COMMERCIAL': return 'Commercial';
    case 'PG': return 'PG';
    default: return 'Property';
  }
}

export function normalizeIndianPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function isValidIndianPhone(input: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeIndianPhone(input));
}

export function isValidUpi(input: string): boolean {
  return /^[a-z0-9._-]{2,64}@[a-z]{2,24}$/i.test(input.trim());
}

export function isValidIfsc(input: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(input.trim());
}

export function sanitizePostgrestSearch(input: string): string {
  return input.replace(/[\\%_(),.*]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? 'Something went wrong');
  }
  return 'Something went wrong. Please try again.';
}
