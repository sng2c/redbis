// Shared types for SqliteStorage modules

import type { PendingEntry, StreamEntry } from '../interface';

export interface InternalStreamGroup {
  name: string;
  lastDeliveredId: string;
  entriesRead: number;
  consumers: Map<string, { name: string; seenTime: number; pendingCount: number; lastDeliveredId: string; lastAckTime: number }>;
  pending: PendingEntry[];
}

export interface StreamData {
  entries: StreamEntry[];
  groups: Map<string, InternalStreamGroup>;
  lastId: string;
  maxDeletedId: string;
  entriesAdded: number;
  recordedFirstId: string;
}

export function formatMemoryHuman(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb.toFixed(2) + 'K';
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + 'M';
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(2) + 'G';
}

export function globToRegex(pattern: string): RegExp {
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      regexStr += '.*';
    } else if (ch === '?') {
      regexStr += '.';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}
