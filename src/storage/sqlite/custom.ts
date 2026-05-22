// @ts-nocheck
import type { SqliteStorage } from './core';

export const customMethods = {
async delex(key: string, conditions: Array<{ operator: string; value: string }>): Promise<number> {
    this.evictExpired(key);
    if (conditions.length === 0) {
      return (await this.delete(key)) ? 1 : 0;
    }
    const current = await this.get(key);
    if (current === null) return 0;
    for (const cond of conditions) {
      const op = cond.operator.toLowerCase();
      switch (op) {
        case 'equ':
          if (current !== cond.value) return 0;
          break;
        case 'neq':
          if (current === cond.value) return 0;
          break;
        case 'gt': {
          const a = parseFloat(current);
          const b = parseFloat(cond.value);
          if (isNaN(a) || isNaN(b) || !(a > b)) return 0;
          break;
        }
        case 'lt': {
          const a = parseFloat(current);
          const b = parseFloat(cond.value);
          if (isNaN(a) || isNaN(b) || !(a < b)) return 0;
          break;
        }
        case 'ge': {
          const a = parseFloat(current);
          const b = parseFloat(cond.value);
          if (isNaN(a) || isNaN(b) || !(a >= b)) return 0;
          break;
        }
        case 'le': {
          const a = parseFloat(current);
          const b = parseFloat(cond.value);
          if (isNaN(a) || isNaN(b) || !(a <= b)) return 0;
          break;
        }
        default:
          return 0;
      }
    }
    return (await this.delete(key)) ? 1 : 0;
  },

async msetex(pairs: Array<{ key: string; seconds: number; value: string }>): Promise<number> {
    for (const { key, seconds, value } of pairs) {
      await this.setex(key, seconds, value);
    }
    return pairs.length;
  },

};
