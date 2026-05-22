import { encodeInteger, encodeBulkString } from '../protocol/resp.js';

// PubSubManager — Centralized pub/sub state shared across all connections.

/**
 * Glob matching implementing Redis KEYS semantics:
 * - `*` matches any sequence of characters (including empty)
 * - `?` matches exactly one character
 * - `[abc]` matches one character in the set
 * - `[a-z]` matches one character in the range
 */
function globMatch(pattern: string, str: string): boolean {
  let pi = 0;
  let si = 0;
  const pLen = pattern.length;
  const sLen = str.length;

  while (pi < pLen && si < sLen) {
    const pc = pattern[pi];
    if (pc === '*') {
      // Try matching 0 or more characters
      pi++;
      if (pi === pLen) return true; // trailing * matches everything
      // Try all possible positions for the remainder of the pattern
      for (let k = si; k <= sLen; k++) {
        if (globMatch(pattern.slice(pi), str.slice(k))) return true;
      }
      return false;
    } else if (pc === '?') {
      pi++;
      si++;
    } else if (pc === '[') {
      pi++;
      if (pi >= pLen) return false; // unterminated bracket
      const negate = pattern[pi] === '^';
      if (negate) pi++;
      let matched = false;
      if (pi < pLen && pattern[pi] === ']') {
        // ']' as first char in set is literal
        if (str[si] === ']') matched = true;
        pi++;
      }
      while (pi < pLen && pattern[pi] !== ']') {
        if (pi + 2 < pLen && pattern[pi + 1] === '-') {
          // Range: [a-z]
          const rangeStart = pattern[pi];
          const rangeEnd = pattern[pi + 2];
          if (str[si] >= rangeStart && str[si] <= rangeEnd) {
            matched = true;
          }
          pi += 3;
        } else {
          if (str[si] === pattern[pi]) matched = true;
          pi++;
        }
      }
      if (pi < pLen && pattern[pi] === ']') pi++; // skip closing bracket
      if (negate) matched = !matched;
      if (!matched) return false;
      si++;
    } else {
      if (pc !== str[si]) return false;
      pi++;
      si++;
    }
  }

  // Remaining pattern chars must all be '*' to match
  while (pi < pLen && pattern[pi] === '*') pi++;
  return pi === pLen && si === sLen;
}

export class PubSubManager {
  // connId → set of channel names
  private channelSubs: Map<string, Set<string>> = new Map();
  // connId → set of glob patterns
  private patternSubs: Map<string, Set<string>> = new Map();
  // channel → connId → sendFn
  private channelToConns: Map<string, Map<string, (msg: string) => void>> = new Map();
  // pattern → connId → sendFn
  private patternToConns: Map<string, Map<string, (msg: string) => void>> = new Map();

  constructor() {}

  private totalSubCount(connId: string): number {
    const ch = this.channelSubs.get(connId);
    const pt = this.patternSubs.get(connId);
    return (ch ? ch.size : 0) + (pt ? pt.size : 0);
  }

  /** Subscribe a connection to one or more channels. Returns array of RESP subscribe-confirm strings, one per channel. */
  subscribe(connId: string, channels: string[], sendFn: (msg: string) => void): string[] {
    if (!this.channelSubs.has(connId)) {
      this.channelSubs.set(connId, new Set());
    }
    if (!this.channelToConns.has(connId)) {
      // We don't need per-conn reverse mapping; we track per-channel
    }
    const results: string[] = [];
    for (const channel of channels) {
      this.channelSubs.get(connId)!.add(channel);
      if (!this.channelToConns.has(channel)) {
        this.channelToConns.set(channel, new Map());
      }
      this.channelToConns.get(channel)!.set(connId, sendFn);
      const total = this.totalSubCount(connId);
      results.push(
        '*3\r\n' +
        '$9\r\nsubscribe\r\n' +
        encodeBulkString(channel) +
        encodeInteger(total)
      );
    }
    return results;
  }

  /** Unsubscribe a connection from specific channels (or all channels if empty array). Returns array of RESP unsubscribe-confirm strings. */
  unsubscribe(connId: string, channels: string[]): string[] {
    const results: string[] = [];
    const subs = this.channelSubs.get(connId);
    if (!subs || subs.size === 0) {
      if (channels.length === 0) {
        // No channel subs, return single confirmation with null channel
        results.push(
          '*3\r\n' +
          '$11\r\nunsubscribe\r\n' +
          encodeBulkString(null) +
          encodeInteger(0)
        );
        return results;
      }
    }

    const toUnsub = channels.length === 0
      ? (subs ? Array.from(subs) : [])
      : channels;

    for (const channel of toUnsub) {
      if (subs && subs.has(channel)) {
        subs.delete(channel);
        const conns = this.channelToConns.get(channel);
        if (conns) {
          conns.delete(connId);
          if (conns.size === 0) {
            this.channelToConns.delete(channel);
          }
        }
      }
      const total = this.totalSubCount(connId);
      results.push(
        '*3\r\n' +
        '$11\r\nunsubscribe\r\n' +
        encodeBulkString(channel) +
        encodeInteger(total)
      );
    }

    // Clean up empty subs set
    if (subs && subs.size === 0) {
      this.channelSubs.delete(connId);
    }

    // If channels was empty and we had nothing to unsub, return one confirmation with null
    if (channels.length === 0 && results.length === 0) {
      results.push(
        '*3\r\n' +
        '$11\r\nunsubscribe\r\n' +
        encodeBulkString(null) +
        encodeInteger(0)
      );
    }

    return results;
  }

  /** Pattern-subscribe. Returns array of RESP subscribe-confirm strings, one per pattern. */
  psubscribe(connId: string, patterns: string[], sendFn: (msg: string) => void): string[] {
    if (!this.patternSubs.has(connId)) {
      this.patternSubs.set(connId, new Set());
    }
    const results: string[] = [];
    for (const pattern of patterns) {
      this.patternSubs.get(connId)!.add(pattern);
      if (!this.patternToConns.has(pattern)) {
        this.patternToConns.set(pattern, new Map());
      }
      this.patternToConns.get(pattern)!.set(connId, sendFn);
      const total = this.totalSubCount(connId);
      results.push(
        '*3\r\n' +
        '$10\r\npsubscribe\r\n' +
        encodeBulkString(pattern) +
        encodeInteger(total)
      );
    }
    return results;
  }

  /** Pattern-unsubscribe. Returns array of RESP unsubscribe-confirm strings. */
  punsubscribe(connId: string, patterns: string[]): string[] {
    const results: string[] = [];
    const subs = this.patternSubs.get(connId);
    if (!subs || subs.size === 0) {
      if (patterns.length === 0) {
        results.push(
          '*3\r\n' +
          '$12\r\npunsubscribe\r\n' +
          encodeBulkString(null) +
          encodeInteger(0)
        );
        return results;
      }
    }

    const toUnsub = patterns.length === 0
      ? (subs ? Array.from(subs) : [])
      : patterns;

    for (const pattern of toUnsub) {
      if (subs && subs.has(pattern)) {
        subs.delete(pattern);
        const conns = this.patternToConns.get(pattern);
        if (conns) {
          conns.delete(connId);
          if (conns.size === 0) {
            this.patternToConns.delete(pattern);
          }
        }
      }
      const total = this.totalSubCount(connId);
      results.push(
        '*3\r\n' +
        '$12\r\npunsubscribe\r\n' +
        encodeBulkString(pattern) +
        encodeInteger(total)
      );
    }

    if (subs && subs.size === 0) {
      this.patternSubs.delete(connId);
    }

    if (patterns.length === 0 && results.length === 0) {
      results.push(
        '*3\r\n' +
        '$12\r\npunsubscribe\r\n' +
        encodeBulkString(null) +
        encodeInteger(0)
      );
    }

    return results;
  }

  /** Publish a message. Returns number of clients that received it (sum of channel + pattern matches, deduplicated). */
  publish(channel: string, message: string): number {
    const receivedConns: Set<string> = new Set();

    // Direct channel subscribers
    const chConns = this.channelToConns.get(channel);
    if (chConns) {
      for (const [connId, sendFn] of chConns) {
        const msg =
          '*3\r\n' +
          '$7\r\nmessage\r\n' +
          encodeBulkString(channel) +
          encodeBulkString(message);
        sendFn(msg);
        receivedConns.add(connId);
      }
    }

    // Pattern subscribers whose pattern matches the channel
    for (const [pattern, conns] of this.patternToConns) {
      if (globMatch(pattern, channel)) {
        for (const [connId, sendFn] of conns) {
          const msg =
            '*4\r\n' +
            '$8\r\npmessage\r\n' +
            encodeBulkString(pattern) +
            encodeBulkString(channel) +
            encodeBulkString(message);
          sendFn(msg);
          receivedConns.add(connId);
        }
      }
    }

    return receivedConns.size;
  }

  /** List active channels (optionally filtered by glob pattern). */
  getChannels(pattern?: string): string[] {
    const channels = Array.from(this.channelToConns.keys());
    if (!pattern) return channels.sort();
    return channels.filter(ch => globMatch(pattern, ch)).sort();
  }

  /** Get subscriber counts per channel. Returns array of [channel, count] pairs. */
  getNumSub(channels: string[]): [string, number][] {
    return channels.map(ch => {
      const conns = this.channelToConns.get(ch);
      return [ch, conns ? conns.size : 0] as [string, number];
    });
  }

  /** Get count of unique pattern subscriptions. */
  getNumPat(): number {
    return this.patternToConns.size;
  }

  /** Remove all subscriptions for a connection. Call on socket close. */
  unsubscribeAll(connId: string): void {
    // Remove channel subscriptions
    const chSubs = this.channelSubs.get(connId);
    if (chSubs) {
      for (const channel of chSubs) {
        const conns = this.channelToConns.get(channel);
        if (conns) {
          conns.delete(connId);
          if (conns.size === 0) {
            this.channelToConns.delete(channel);
          }
        }
      }
      this.channelSubs.delete(connId);
    }

    // Remove pattern subscriptions
    const ptSubs = this.patternSubs.get(connId);
    if (ptSubs) {
      for (const pattern of ptSubs) {
        const conns = this.patternToConns.get(pattern);
        if (conns) {
          conns.delete(connId);
          if (conns.size === 0) {
            this.patternToConns.delete(pattern);
          }
        }
      }
      this.patternSubs.delete(connId);
    }
  }

  /** Check if a connection has any subscriptions. */
  hasSubscriptions(connId: string): boolean {
    const ch = this.channelSubs.get(connId);
    const pt = this.patternSubs.get(connId);
    return ((ch ? ch.size : 0) + (pt ? pt.size : 0)) > 0;
  }
}