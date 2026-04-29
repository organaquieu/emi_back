export function buildAlexithymicCode(userId: string): string {
  return `C-${userId.replace(/-/g, '').toUpperCase()}`;
}
