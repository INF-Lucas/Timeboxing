'use client';

import { db } from '@/lib/db';
import type { Settings } from '@/lib/types';

export async function initDefaultSettings(): Promise<Settings> {
  const defaults: Settings = {
    id: 'singleton',
    planning_default_minutes: 15,
    meeting_prep_min: 15,
    focus_shield: true,
    workday_start: '09:00',
    workday_end: '18:00',
    colors_by_tag: {},
    calendar_integration_enabled: false,
  };
  await db.settings.put(defaults);
  return defaults;
}

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('singleton');
  if (existing) return existing;
  return await initDefaultSettings();
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await db.settings.put(next);
  return next;
}