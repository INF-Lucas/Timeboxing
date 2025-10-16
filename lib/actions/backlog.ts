'use client';

import { db } from '@/lib/db';
import type { BacklogItem } from '@/lib/types';

export async function createBacklogItem(input: {
  title: string;
  estimate_min?: number;
  tags?: string[];
  notes?: string;
}): Promise<BacklogItem> {
  const item: BacklogItem = {
    id: crypto.randomUUID(),
    title: input.title,
    notes: input.notes,
    tags: input.tags ?? [],
    estimate_min: input.estimate_min ?? 30,
  };
  await db.backlog.put(item);
  return item;
}

export async function listBacklog(): Promise<BacklogItem[]> {
  const rows = await db.backlog.toArray();
  return rows;
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await db.backlog.delete(id);
}

export async function updateBacklogItem(
  id: string,
  patch: Partial<Pick<BacklogItem, 'title' | 'estimate_min' | 'tags' | 'notes'>>
): Promise<BacklogItem> {
  const prev = await db.backlog.get(id);
  if (!prev) throw new Error('Backlog 不存在');
  const next: BacklogItem = { ...prev, ...patch };
  await db.backlog.put(next);
  return next;
}