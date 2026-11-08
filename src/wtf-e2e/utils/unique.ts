export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export function uniqueCode(prefix: string = 'E'): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10).toUpperCase();
}

export function uniqueUsername(prefix: string = 'e2e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.toLowerCase();
}

// Time plus a random part: two workers starting in the same millisecond must not get the same stamp.
export function uniqueStamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}
