export function eMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown Error.';
}

export function eHasCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && 'code' in e && e.code !== 'EEXIST';
}
