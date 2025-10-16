'use client';

import { db } from '@/lib/db';
import type { Box, BoxStatus, LogEvent, Settings } from '@/lib/types';
import { getSettings } from './settings';

function now(): Date {
  return new Date();
}

function dateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return dateYMD(a) === dateYMD(b);
}

function toDayTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function diffMin(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

async function log(box_id: string, event: LogEvent, payload?: Record<string, unknown>) {
  await db.logs.put({
    id: crypto.randomUUID(),
    box_id,
    event,
    payload,
    created_at: now(),
  });
}

export type CreateBoxInput = Omit<Box, 'id' | 'status' | 'created_at' | 'updated_at'> & {
  status?: BoxStatus;
};

export async function createBox(input: CreateBoxInput): Promise<Box> {
  if (input.start >= input.end) {
    throw new Error('start 必须早于 end');
  }
  const box: Box = {
    id: crypto.randomUUID(),
    title: input.title,
    start: input.start,
    end: input.end,
    status: input.status ?? 'planned',
    tags: input.tags ?? [],
    color: input.color,
    energy: input.energy,
    location: input.location,
    notes: input.notes,
    links: input.links,
    is_plan_session: input.is_plan_session ?? false,
    created_at: now(),
    updated_at: now(),
  };

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.put(box);
    await log(box.id, 'create', { box });
  });

  return box;
}

export async function getActiveBox(): Promise<Box | undefined> {
  return await db.boxes.where('status').equals('active').first();
}

export async function startBox(boxId: string): Promise<void> {
  const existingActive = await getActiveBox();
  if (existingActive && existingActive.id !== boxId) {
    throw new Error('当前已有 active 盒子，禁止并行。请先完成/切换。');
  }

  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { status: 'active', updated_at: now() });
    await log(boxId, 'start');
  });
}

export async function finishBox(boxId: string): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { status: 'done', updated_at: now() });
    await log(boxId, 'done');
  });
}

export async function extendBox(boxId: string, deltaMinutes: number): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');
  const newEnd = new Date(box.end.getTime() + deltaMinutes * 60000);

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { end: newEnd, updated_at: now() });
    await log(boxId, 'extend', { deltaMinutes, prevEnd: box.end, newEnd });
  });
}

export async function deleteBox(boxId: string): Promise<void> {
  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.delete(boxId);
    await log(boxId, 'delete');
  });
}

// 查询某日盒子（包含所有状态）
export async function getBoxesForDay(day: Date): Promise<Box[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  const rows = await db.boxes.where('start').between(start, end, true, true).toArray();
  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// 计算下一空窗（简单版）：在工作日范围内，按已有盒子寻找不重叠区间
export async function findNextFreeSlot(
  day: Date,
  durationMinutes: number,
  from?: Date,
  excludeBoxId?: string
): Promise<{ start: Date; end: Date } | undefined> {
  const settings = await getSettings();
  const workStart = toDayTime(day, settings.workday_start);
  const workEnd = toDayTime(day, settings.workday_end);

  const anchor = from && sameDay(from, day) ? (from > workStart ? from : workStart) : workStart;
  const rows = await getBoxesForDay(day);
  const boxes = rows.filter((b) => !excludeBoxId || b.id !== excludeBoxId);

  let cursor = anchor;
  for (const b of boxes) {
    if (b.end <= cursor) continue;

    if (b.start > cursor) {
      const gapEnd = b.start;
      const gapMin = diffMin(cursor, gapEnd);
      if (gapMin >= durationMinutes) {
        return { start: cursor, end: new Date(cursor.getTime() + durationMinutes * 60000) };
      }
      cursor = b.end;
      if (cursor >= workEnd) return undefined;
      continue;
    }

    if (b.end > cursor) {
      cursor = b.end;
      if (cursor >= workEnd) return undefined;
    }
  }

  if (diffMin(cursor, workEnd) >= durationMinutes) {
    return { start: cursor, end: new Date(cursor.getTime() + durationMinutes * 60000) };
  }

  return undefined;
}

// 将盒子整体移动到下一空窗
export async function shiftBox(boxId: string): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');
  const duration = diffMin(box.start, box.end);

  // 将“起点”锚定到当前时间之后（仅当盒子在“今天”），避免顺延结果仍位于当前之前
  const nowTime = now();
  const isToday = sameDay(box.start, nowTime);
  const settings = await getSettings();

  // 基准日：今天顺延则用“今天”，过去日期顺延则用“明天”
  const baseDay = new Date(box.start);
  if (!isToday) baseDay.setDate(baseDay.getDate() + 1);

  // 基准起点：今天用 max(now, box.end)，过去日期用工作日起点
  const baseFrom = isToday
    ? (nowTime > box.end ? nowTime : box.end)
    : toDayTime(baseDay, settings.workday_start);

  // 先尝试基准日
  let slot = await findNextFreeSlot(baseDay, duration, baseFrom, box.id);

  // 逐日兜底（最多 7 天），从工作日起点开始找空窗
  if (!slot) {
    for (let i = 1; i <= 7 && !slot; i++) {
      const day = new Date(baseDay);
      day.setDate(day.getDate() + i);
      const from = toDayTime(day, settings.workday_start);
      slot = await findNextFreeSlot(day, duration, from, box.id);
    }
  }

  if (!slot) throw new Error('未来 7 天均无空窗可顺延');

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { start: slot.start, end: slot.end, status: 'planned', updated_at: now() });
    await log(boxId, 'shift', { prev: { start: box.start, end: box.end }, next: slot });
  });
}

// 将 active 盒子分割：当前结束为 done，新建剩余 planned 盒（放入下一空窗）
export async function splitActiveBox(boxId: string): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');
  if (box.status !== 'active') throw new Error('仅 active 盒可分割');

  const currentEnd = now();
  if (currentEnd <= box.start) throw new Error('当前时间不在盒子执行区间内');
  // 向上取整，避免剩余 < 1 分钟被算为 0
  const remainingMs = box.end.getTime() - currentEnd.getTime();
  const remainingMin = Math.ceil(remainingMs / 60000);
  if (remainingMin <= 0) {
    await finishBox(boxId);
    return;
  }

  // 排除当前 active 盒，避免自阻塞
  const slot = await findNextFreeSlot(box.start, remainingMin, currentEnd, box.id);
  if (!slot) throw new Error('今日无空窗安放剩余时长');

  const newBox: CreateBoxInput = {
    title: box.title,
    start: slot.start,
    end: slot.end,
    status: 'planned',
    tags: box.tags,
    color: box.color,
    energy: box.energy,
    location: box.location,
    notes: box.notes,
    links: box.links,
    is_plan_session: false,
  };

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    // 完成当前
    await db.boxes.update(boxId, { status: 'done', end: currentEnd, updated_at: now() });
    await log(boxId, 'split', { finishedAt: currentEnd, remainderMinutes: remainingMin });

    // 新建剩余 planned
    const created = await createBox(newBox);
    await log(created.id, 'create', { reason: 'split remainder' });
  });
}

// 当日“计划盒”自动生成（若不存在）
export async function ensurePlanSessionForDay(day: Date): Promise<Box> {
    const settings = await getSettings();

    // 用“start”的当日范围作为有效键查询，再过滤 is_plan_session
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await db.boxes
      .where('start')
      .between(dayStart, dayEnd, true, true)
      .filter((b) => b.is_plan_session === true)
      .first();

    if (existing) return existing;

    const start = toDayTime(day, settings.workday_start);
    const end = new Date(start.getTime() + settings.planning_default_minutes * 60000);

    return await createBox({
      title: '制定今日计划',
      start,
      end,
      status: 'planned',
      is_plan_session: true,
      tags: ['已计划'],
      color: '#2563eb',
      notes: '每日 15–30 分钟计划环节',
    });
}

export async function updateBoxTimes(boxId: string, nextStart: Date, nextEnd: Date): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');
  if (nextStart >= nextEnd) throw new Error('start 必须早于 end');

  const extended = nextEnd.getTime() > box.end.getTime();

  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { start: nextStart, end: nextEnd, updated_at: now() });
    await log(boxId, extended ? 'extend' : 'shift', {
      prev: { start: box.start, end: box.end },
      next: { start: nextStart, end: nextEnd },
    });
  });
}

export async function updateBoxMeta(
  boxId: string,
  patch: Partial<Pick<Box, 'title' | 'tags' | 'color' | 'energy' | 'location' | 'notes' | 'links'>>
): Promise<void> {
  const box = await db.boxes.get(boxId);
  if (!box) throw new Error('Box 不存在');
  await db.transaction('rw', [db.boxes, db.logs], async () => {
    await db.boxes.update(boxId, { ...patch, updated_at: now() });
    await log(boxId, 'update', { patch });
  });
}

export async function markMissedForDay(day: Date): Promise<number> {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  const nowTime = now();
  // 未来日期不处理
  if (dayStart > nowTime) return 0;

  const cutoff = dateYMD(day) === dateYMD(nowTime) ? nowTime : dayEnd;
  const rows = await getBoxesForDay(day);

  let count = 0;
  await db.transaction('rw', [db.boxes, db.logs], async () => {
    for (const b of rows) {
      // 添加缓冲逻辑：新创建的时间盒在创建后5分钟内不会被标记为missed
      const createdTime = b.created_at;
      const bufferTime = new Date(createdTime.getTime() + 5 * 60000); // 5分钟缓冲
      const effectiveCutoff = bufferTime > cutoff ? bufferTime : cutoff;
      
      if (b.status === 'planned' && b.end < effectiveCutoff) {
        await db.boxes.update(b.id, { status: 'missed', updated_at: now() });
        await log(b.id, 'update', { prevStatus: 'planned', nextStatus: 'missed' });
        count++;
      }
    }
  });
  return count;
}