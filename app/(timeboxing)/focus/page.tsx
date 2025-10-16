'use client';

import { useDate } from '../components/DateProvider';
import { useEffect, useMemo, useState } from 'react';
import type { Box } from '@/lib/types';
import {
  getBoxesForDay,
  startBox,
  finishBox,
  splitActiveBox,
  shiftBox,
  extendBox,
  findNextFreeSlot,
  updateBoxTimes,
} from '@/lib/actions/boxes';
import { hasOverlap } from '@/lib/utils/overlap';
import { getSettings } from '@/lib/actions/settings';

export default function FocusPage() {
  const { selectedDate, formatForInput } = useDate();

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const [toast, setToast] = useState<string | null>(null);
  function showToast(text: string) {
    // 专注保护开启且有 active 时屏蔽提示
    if (shieldOnActive) return;
    setToast(text);
    setTimeout(() => setToast(null), 1600);
  }

  const [extendConflict, setExtendConflict] = useState(false);
  const [extendDraft, setExtendDraft] = useState<{
    boxId: string;
    title: string;
    prevStart: Date;
    prevEnd: Date;
    nextEnd: Date;
    minutes: number;
  } | null>(null);

  function hasConflict(start: Date, end: Date, excludeId?: string): boolean {
    return hasOverlap(start, end, boxes, excludeId);
  }

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  async function refreshBoxes() {
    const rows = await getBoxesForDay(selectedDate);
    setBoxes(rows);
  }

  useEffect(() => {
    refreshBoxes();
  }, [selectedDate]);

  const activeBox = useMemo(() => boxes.find((b) => b.status === 'active'), [boxes]);
  const dueBox = useMemo(
    () => boxes.find((b) => b.status === 'planned' && b.start <= now && b.end > now),
    [boxes, now]
  );
  const nextPlanned = useMemo(
    () =>
      boxes
        .filter((b) => b.status === 'planned' && b.start > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0],
    [boxes, now]
  );

  function fmtHM(d: Date) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const remainingMin = activeBox ? Math.max(0, Math.ceil((activeBox.end.getTime() - now.getTime()) / 60000)) : 0;

  async function handleStart(id: string) {
    setBusy(true);
    try {
      await startBox(id);
      await refreshBoxes();
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!activeBox) return;
    setBusy(true);
    try {
      await finishBox(activeBox.id);
      await refreshBoxes();
    } finally {
      setBusy(false);
    }
  }

  async function handleSnooze(boxId: string) {
    setBusy(true);
    try {
      await shiftBox(boxId);
      await refreshBoxes();
      showToast('已延后到下一空窗');
    } finally {
      setBusy(false);
    }
  }

  async function handleSplit() {
    if (!activeBox) return;
    setBusy(true);
    try {
      await splitActiveBox(activeBox.id);
      await refreshBoxes();
    } finally {
      setBusy(false);
    }
  }

  async function handleExtend(delta: number) {
    if (!activeBox) return;
    const nextEnd = new Date(activeBox.end.getTime() + delta * 60000);

    if (hasConflict(activeBox.start, nextEnd, activeBox.id)) {
      setExtendDraft({
        boxId: activeBox.id,
        title: activeBox.title,
        prevStart: activeBox.start,
        prevEnd: activeBox.end,
        nextEnd,
        minutes: delta,
      });
      setExtendConflict(true);
      return;
    }

    setBusy(true);
    try {
      await extendBox(activeBox.id, delta);
      await refreshBoxes();
      showToast(`已延长 ${delta} 分钟`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmExtend() {
    if (!extendDraft) return;
    setBusy(true);
    try {
      await extendBox(extendDraft.boxId, extendDraft.minutes);
      await refreshBoxes();
      showToast(`仍然延长 ${extendDraft.minutes} 分钟`);
    } finally {
      setBusy(false);
      setExtendConflict(false);
      setExtendDraft(null);
    }
  }

  async function moveExtendConflictToNextFreeSlot() {
    if (!extendDraft) return;
    const duration = Math.round((extendDraft.nextEnd.getTime() - extendDraft.prevStart.getTime()) / 60000);
    setBusy(true);
    try {
      const slot = await findNextFreeSlot(selectedDate, duration, extendDraft.nextEnd);
      if (!slot) {
        alert('今日无可用空窗可解决冲突');
      } else {
        await updateBoxTimes(extendDraft.boxId, slot.start, slot.end);
        await refreshBoxes();
        showToast('已移到下一空窗');
        setExtendConflict(false);
        setExtendDraft(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function cancelExtend() {
    setExtendConflict(false);
    setExtendDraft(null);
  }

  // 读取设置并计算专注保护状态
  const [settings, setSettings] = useState<{ focus_shield: boolean } | null>(null);
  const shieldOnActive = useMemo(
  () => !!settings?.focus_shield && !!activeBox,
  [settings, activeBox]
  );

  useEffect(() => {
  (async () => {
  const s = await getSettings();
  setSettings(s);
  })();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (busy) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.getAttribute('contenteditable') === 'true';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      const key = e.key;

      // 完成优先，允许空格/回车
      if (key === ' ' || key === 'Enter') {
        if (activeBox) {
          e.preventDefault();
          handleFinish();
          return;
        }
        if (dueBox) {
          e.preventDefault();
          handleStart(dueBox.id);
          return;
        }
        if (!dueBox && nextPlanned) {
          e.preventDefault();
          handleStart(nextPlanned.id);
          return;
        }
      }

      // 专注保护开启时屏蔽分割/顺延/延长快捷键
      if (shieldOnActive) return;

      if (key.toLowerCase() === 'x' && activeBox) {
        e.preventDefault();
        handleSplit();
        return;
      }

      if (key.toLowerCase() === 's') {
        if (dueBox) {
          e.preventDefault();
          handleSnooze(dueBox.id);
          return;
        }
        if (!dueBox && nextPlanned) {
          e.preventDefault();
          handleSnooze(nextPlanned.id);
          return;
        }
      }

      if (key === '5' && activeBox) {
        e.preventDefault();
        handleExtend(5);
        return;
      }
      if (key === '0' && activeBox) {
        e.preventDefault();
        handleExtend(10);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeBox, dueBox, nextPlanned, busy, shieldOnActive]);

  return (
    <div>
      {toast ? (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-purple-800 text-white text-xs rounded-full px-3 py-2 shadow">
          {toast}
        </div>
      ) : null}

      {shieldOnActive ? (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
          专注保护已开启：已屏蔽提示与部分快捷键
        </div>
      ) : null}

      <h1 className="text-2xl font-semibold mb-2">Focus 执行</h1>
      <p className="text-sm text-gray-600">当前日期：{formatForInput(selectedDate)}</p>

      {activeBox ? (
        <div className="mt-4 border rounded-2xl bg-yellow-50/30 p-4">
          <div className="text-lg font-medium">{activeBox.title}</div>
          <div className="text-sm text-gray-600 mt-1">
            {fmtHM(activeBox.start)} — {fmtHM(activeBox.end)}（剩余约 {remainingMin} 分钟）
          </div>
          <div className="flex gap-2 mt-3">
            <button
              className="px-3 py-1 rounded-full bg-purple-800 text-white disabled:opacity-50"
              onClick={handleFinish}
              disabled={busy}
            >
              完成
            </button>
            <button
              className="px-3 py-1 rounded-full bg-indigo-600 text-white disabled:opacity-50"
              onClick={handleSplit}
              disabled={busy || shieldOnActive}
              title="到当前为止完成，并将剩余部分安排到下一空窗"
            >
              分割
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="border rounded-2xl bg-yellow-50/30 p-4">
            <div className="font-medium mb-2">当前无进行中盒子</div>
            {dueBox ? (
              <div>
                <div className="text-sm text-gray-700">
                  当前时段应做：{dueBox.title}（{fmtHM(dueBox.start)} — {fmtHM(dueBox.end)}）
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    className="px-3 py-1 rounded-full bg-green-600 text-white disabled:opacity-50"
                    onClick={() => handleStart(dueBox.id)}
                    disabled={busy}
                  >
                    开始
                  </button>
                  <button
                    className="px-3 py-1 rounded-full bg-amber-500 text-white disabled:opacity-50"
                    onClick={() => handleSnooze(dueBox.id)}
                    disabled={busy || shieldOnActive}
                    title="顺延到下一空窗"
                  >
                    顺延
                  </button>
                </div>
              </div>
            ) : nextPlanned ? (
              <div>
                <div className="text-sm text-gray-700">
                  下一个：{nextPlanned.title}（{fmtHM(nextPlanned.start)} — {fmtHM(nextPlanned.end)}）
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    className="px-3 py-1 rounded-full bg-green-600 text-white disabled:opacity-50"
                    onClick={() => handleStart(nextPlanned.id)}
                    disabled={busy}
                  >
                    开始
                  </button>
                  <button
                    className="px-3 py-1 rounded-full bg-amber-500 text-white disabled:opacity-50"
                    onClick={() => handleSnooze(nextPlanned.id)}
                    disabled={busy || shieldOnActive}
                  >
                    顺延
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">今日暂无待做盒子。</div>
            )}
          </div>
        </div>
      )}

      {extendConflict && extendDraft ? (
        <div className="mt-3 border rounded-2xl p-2 bg-rose-50">
          <div className="font-medium mb-1">时间冲突</div>
          <div className="text-xs text-gray-600 mb-2">
            [{extendDraft.title}] {fmtHM(extendDraft.prevStart)} — {fmtHM(extendDraft.nextEnd)}
          </div>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 text-xs rounded-full bg-blue-600 text-white disabled:opacity-50"
              onClick={confirmExtend}
              disabled={busy}
            >
              仍然延长（{extendDraft.minutes}m）
            </button>
            <button
              className="px-2 py-1 text-xs rounded-full bg-gray-200 disabled:opacity-50"
              onClick={moveExtendConflictToNextFreeSlot}
              disabled={busy}
            >
              移到下一空窗
            </button>
            <button className="px-2 py-1 text-xs rounded-full bg-gray-200" onClick={cancelExtend}>
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}