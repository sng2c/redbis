// Shared types for InMemoryStorage modules

import type { StreamEntry, PendingEntry } from '../interface';

export type StoreEntry = { value: string; type: string; expiresAt: number | null };

export interface InternalStreamConsumer {
  name: string;
  seenTime: number;
  pendingCount: number;
  lastDeliveredId: string;
  lastAckTime: number;
}

export interface InternalStreamGroup {
  name: string;
  lastDeliveredId: string;
  entriesRead: number;
  consumers: Map<string, InternalStreamConsumer>;
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
