export const WRONGTYPE_ERROR = 'WRONGTYPE Operation against a key holding the wrong kind of value';

/** Throw WRONGTYPE if actualType is defined but doesn't match expectedType */
export function assertType(actualType: string | undefined, expectedType: string): void {
  if (actualType && actualType !== expectedType) {
    throw new Error(WRONGTYPE_ERROR);
  }
}

/** Throw WRONGTYPE if actualType is defined but doesn't match any of expectedTypes (for sort which accepts list|set|zset) */
export function assertTypeOneOf(actualType: string | undefined, expectedTypes: string[]): void {
  if (actualType && !expectedTypes.includes(actualType)) {
    throw new Error(WRONGTYPE_ERROR);
  }
}