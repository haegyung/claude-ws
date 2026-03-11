import { timingSafeEqual } from 'crypto';

/**
 * Timing-safe string comparison to prevent timing attacks on API key validation.
 * Always runs in constant time regardless of whether lengths match.
 */
export function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Run comparison anyway to avoid leaking length via timing
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
