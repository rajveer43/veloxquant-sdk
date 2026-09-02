export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

export function check(ok: boolean): string {
  return ok ? '✓' : '✗';
}
