'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import type { Box } from '@/lib/types';
import {
  startBox,
  finishBox,
  deleteBox,
  updateBoxTimes,
  findNextFreeSlot,
  shiftBox,
  splitActiveBox,
} from '@/lib/actions/boxes';
import { hasOverlap } from '@/lib/utils/overlap';

type Props = {
  day: Date;
  boxes: Box[];
  onChanged: () => Promise<void>;
  // 允许传入 undefined 以取消选中
  onSelectBox?: (box?: Box) => void;
  selectedBoxId?: string;
};

function toDayTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function diffMin(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function formatHM(d: Date) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function DayCalendar({
  day,
  boxes,
  onChanged,
  onSelectBox,
  selectedBoxId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 显示范围：07:00—22:00（独立于工作日设置）
  const displayStart = useMemo(() => toDayTime(day, '07:00'), [day]);
  const displayEnd = useMemo(() => toDayTime(day, '22:00'), [day]);
  const totalMin = useMemo(() => diffMin(displayStart, displayEnd), [displayStart, displayEnd]);

  // 坐标与网格
  const pxPerMin = 2; // 1 分钟 = 2px
  const MIN_BOX_MINUTES = 15;
  const roundStep = 5; // 5 分钟步进

  // 左侧标签列宽度（px）+ 内容区左右内边距
  const LABEL_COL_WIDTH = 48;      // 左侧小时标签列宽
  const CONTENT_LEFT_PAD = 8;      // 内容区左内边距
  const CONTENT_RIGHT_PAD = 8;     // 内容区右内边距

  // 小时刻度（基于显示范围）
  const hours = useMemo(() => {
    const list: Date[] = [];
    const d = new Date(displayStart);
    while (d <= displayEnd) {
      list.push(new Date(d));
      d.setHours(d.getHours() + 1, 0, 0, 0);
    }
    return list;
  }, [displayStart, displayEnd]);

  // 坐标换算（统一使用显示范围）
  function clampToDisplay(t: Date): Date {
    if (t < displayStart) return new Date(displayStart);
    if (t > displayEnd) return new Date(displayEnd);
    return t;
  }

  function roundToStep(t: Date): Date {
    const min = Math.round(t.getMinutes() / roundStep) * roundStep;
    const d = new Date(t);
    d.setMinutes(min, 0, 0);
    return d;
  }

  function timeToY(t: Date): number {
    const clamped = clampToDisplay(t);
    const minutes = diffMin(displayStart, clamped);
    return minutes * pxPerMin;
  }

  function yToTime(y: number): Date {
    const min = Math.round(y / pxPerMin);
    const d = new Date(displayStart);
    d.setMinutes(d.getMinutes() + min, 0, 0);
    return roundToStep(clampToDisplay(d));
  }

  function getYFromPointer(e: PointerEvent): number {
    const el = containerRef.current!;
    const rect = el.getBoundingClientRect();
    return e.clientY - rect.top + el.scrollTop;
  }

  // 交互态：仅移动/拉伸
  const [moving, setMoving] = useState<{ id: string; durationMin: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; start: Date } | null>(null);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);
  const interacting = !!resizing || !!moving;
  const [busy, setBusy] = useState(false);

  // 长按拖拽状态
  const [isDragReady, setIsDragReady] = useState(false);
  const [dragTimer, setDragTimer] = useState<NodeJS.Timeout | null>(null);

  // 长按拖拽逻辑
  function handlePointerDown(box: Box, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    
    // 设置长按定时器（300ms后启用拖拽）
    const timer = setTimeout(() => {
      setIsDragReady(true);
      startMove(box, e);
    }, 300);
    
    setDragTimer(timer);
  }

  function handlePointerUpForDrag() {
    // 清除长按定时器
    if (dragTimer) {
      clearTimeout(dragTimer);
      setDragTimer(null);
    }
    setIsDragReady(false);
  }

  function handleClick(box: Box, e: React.MouseEvent) {
    // 如果没有进入拖拽状态，则执行点击逻辑
    if (!isDragReady && !moving) {
      onSelectBox?.(box);
    }
  }

  // 冲突状态
  const [conflict, setConflict] = useState<{ start: Date; end: Date; boxId: string } | null>(null);

  // 冲突弹窗的就近定位（锚定到冲突结束时间附近）
  const POP_HEIGHT = 96;
  const conflictPopoverY = useMemo(() => {
    if (!conflict) return null;
    const raw = timeToY(conflict.end);
    const containerHeight = totalMin * pxPerMin; // 背景高度
    const clampedTop = Math.max(raw - POP_HEIGHT / 2, 8); // 上边界 8px
    return Math.min(clampedTop, containerHeight - POP_HEIGHT - 8); // 下边界夹紧
  }, [conflict, totalMin]);

  function hasConflict(start: Date, end: Date, exceptId?: string): boolean {
    return hasOverlap(start, end, boxes, exceptId);
  }

  const liveConflict = useMemo(() => {
    if (moving && draftStart && draftEnd) {
      return hasConflict(draftStart, draftEnd, moving.id);
    }
    if (resizing && draftStart && draftEnd) {
      return hasConflict(draftStart, draftEnd, resizing.id);
    }
    return false;
  }, [boxes, moving, resizing, draftStart, draftEnd]);

  // 紧急程度映射 + 色调
  function getUrgency(b: Box): 'high' | 'medium' | 'low' {
    const tags = (b.tags ?? []).map((t) => t.toLowerCase());
    const includesAny = (keys: string[]) => tags.some((t) => keys.some((k) => t.includes(k)));
    if (includesAny(['#紧急', '紧急', '急', '#urgent', 'urgent', '高', '#high', 'high'])) return 'high';
    if (includesAny(['#中', '中', '#重要', '重要', '#medium', 'medium', '#important', 'important'])) return 'medium';
    if (includesAny(['#低', '低', '不急', '#normal', 'normal', 'low', '#low', '一般', '#一般'])) return 'low';
    if (b.status === 'missed') return 'high';
    if (b.status === 'done') return 'low';
    if (b.status === 'active') return 'medium';
    return 'medium';
  }

  function toneForBox(b: Box): string {
    if (b.is_plan_session) {
      return 'capsule-card bg-gradient-to-br from-blue-100/85 via-indigo-100/75 to-sky-100/85 border-indigo-300/60';
    }
    switch (getUrgency(b)) {
      case 'high':
        return 'capsule-card bg-gradient-to-br from-red-100/85 via-rose-100/75 to-red-100/85 border-red-300/60';
      case 'medium':
        return 'capsule-card bg-gradient-to-br from-amber-100/85 via-yellow-100/75 to-amber-100/85 border-amber-300/60';
      case 'low':
        return 'capsule-card bg-gradient-to-br from-emerald-100/85 via-green-100/75 to-emerald-100/85 border-emerald-300/60';
      default:
        return 'capsule-card bg-gradient-to-br from-slate-100/85 via-gray-100/75 to-slate-100/85 border-slate-300/60';
    }
  }

  // 触发移动/拉伸
  function startMove(box: Box, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (containerRef.current) {
      try {
        containerRef.current.setPointerCapture((e as any).pointerId);
      } catch {}
    }
    const durationMin = diffMin(box.start as Date, box.end as Date);
    setMoving({ id: box.id, durationMin });
    setDraftStart(box.start as Date);
    setDraftEnd(box.end as Date);
  }

  function startResize(box: Box, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (containerRef.current) {
      try {
        containerRef.current.setPointerCapture((e as any).pointerId);
      } catch {}
    }
    setResizing({ id: box.id, start: box.start as Date });
    setDraftStart(box.start as Date);
    setDraftEnd(box.end as Date); // 保持原有时长，而不是缩短到最小
  }

  // 禁用空白区域创建
  function handleEmptyAreaPointerDown(_e: React.PointerEvent<HTMLDivElement>) {
    return;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const EDGE = 48; // 边缘触发阈值（px）
      const STEP = 24; // 每次滚动步进（px）
      if (e.clientY > rect.bottom - EDGE) {
        el.scrollTop = Math.min(el.scrollTop + STEP, el.scrollHeight - el.clientHeight);
      } else if (e.clientY < rect.top + EDGE) {
        el.scrollTop = Math.max(el.scrollTop - STEP, 0);
      }
    }

    const y = getYFromPointer(e.nativeEvent as PointerEvent);

    if (moving && draftStart && draftEnd) {
      const t = yToTime(y);
      const duration = diffMin(draftStart, draftEnd);
      // 使用固定的 box 时长以避免累计误差
      const fixedDuration = moving.durationMin ?? duration;
      setDraftStart(t);
      setDraftEnd(new Date(t.getTime() + fixedDuration * 60000));
    }

    if (resizing && draftStart) {
      const t = yToTime(y);
      const min = diffMin(draftStart, t);
      const end =
        min < MIN_BOX_MINUTES
          ? new Date(draftStart.getTime() + MIN_BOX_MINUTES * 60000)
          : t;
      setDraftEnd(end);
    }
  }

  async function finalizeUpdate(boxId: string, start: Date, end: Date) {
    await updateBoxTimes(boxId, start, end);
    await onChanged();
  }

  // 一键解决冲突：移动到下一空窗（以候选结束时间为锚点）
  async function moveConflictToNextFreeSlot() {
    if (!conflict) return;
    const duration = diffMin(conflict.start, conflict.end);
    const slot = await findNextFreeSlot(day, duration, conflict.end);
    if (!slot) {
      alert('今日无可用空窗可解决冲突');
      return;
    }
    await finalizeUpdate(conflict.boxId, slot.start, slot.end);
    setConflict(null);
  }

  function handleInteractionEnd() {
    // 移动完成 -> 检测冲突
    if (moving && draftStart && draftEnd) {
      if (hasConflict(draftStart, draftEnd, moving.id)) {
        setConflict({ start: draftStart, end: draftEnd, boxId: moving.id });
      } else {
        // 无冲突直接保存
        void finalizeUpdate(moving.id, draftStart, draftEnd);
      }
    }

    // 拉伸完成 -> 检测冲突
    if (resizing && draftStart && draftEnd) {
      if (hasConflict(draftStart, draftEnd, resizing.id)) {
        setConflict({ start: draftStart, end: draftEnd, boxId: resizing.id });
      } else {
        void finalizeUpdate(resizing.id, draftStart, draftEnd);
      }
    }

    // 清理交互态
    setMoving(null);
    setResizing(null);
    setDraftStart(null);
    setDraftEnd(null);
  }

  // 点击空白区域取消选中
  const handleBackgroundClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const target = e.target as HTMLElement;
    // 点击到盒子或其内的交互元素时，不清空选中
    if (target.closest('[data-box="true"]') || target.closest('[data-interactive="true"]')) return;
    onSelectBox?.(undefined);
  };

  // 键盘快捷键（Space/Enter 完成或开始；X 分割；S 顺延；Esc 取消选中）
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (!selectedBoxId) return;
      if (busy) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.getAttribute('contenteditable') === 'true';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      const box = boxes.find((x) => x.id === selectedBoxId);
      if (!box) return;

      const key = e.key.toLowerCase();

      // Esc：取消选中
      if (key === 'escape') {
        onSelectBox?.(undefined);
        return;
      }

      // 空格/Enter：完成或开始
      if (key === ' ' || key === 'enter') {
        e.preventDefault();
        if (box.status === 'active') {
          await finishBox(box.id);
        } else if (box.status === 'planned') {
          await startBox(box.id);
        }
        await onChanged();
        return;
      }

      // X：分割（仅 active）
      if (key === 'x' && box.status === 'active') {
        e.preventDefault();
        await splitActiveBox(box.id);
        await onChanged();
        return;
      }

      // S：顺延（仅 planned）
      if (key === 's' && box.status === 'planned') {
        e.preventDefault();
        await shiftBox(box.id);
        await onChanged();
        return;
      }

      // 移除 Delete 删除快捷键（保留点击“删除”按钮）
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBoxId, boxes, onChanged, onSelectBox, busy]);

  return (
    <div className="relative h-full bg-yellow-50/30" onClick={handleBackgroundClick}>
      {/* 交互时禁用文本选择 */}
      <style>{interacting ? 'html { user-select: none; }' : ''}</style>
      <div
        ref={containerRef}
        className="relative h-full overflow-y-auto overflow-x-hidden"
        onPointerDown={handleEmptyAreaPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handleInteractionEnd}
      >
        {/* 交互遮罩层 */}
        {interacting && (
          <div
            className="absolute inset-0 z-40"
            style={{ background: 'transparent' }}
            onPointerMove={handlePointerMove}
            onPointerUp={handleInteractionEnd}
          />
        )}

        {/* 背景小时线 + 标签列分离 */}
        <div style={{ height: `${totalMin * pxPerMin}px` }} className="relative pt-5 pb-5">
          {/* 小时刻度 */}
          {hours.map((h, i) => (
            <div key={i} className="absolute" style={{ top: `${timeToY(h)}px`, height: 0 }}>
              <div className="absolute border-t border-slate-200/60" style={{ left: LABEL_COL_WIDTH, right: 0 }} />
              <div className="absolute top-1 left-2 w-[40px] text-[10px] text-slate-600 bg-white/95 px-2 py-1 rounded-full border border-slate-200/60 shadow-sm z-30 pointer-events-none text-center font-medium">
                {`${String(h.getHours()).padStart(2, '0')}:00`}
              </div>
            </div>
          ))}

          {/* 事件卡片（放回 map 回调作用域，矩形圆角） */}
          {boxes
            .filter((b) => (b.start as Date) < displayEnd && (b.end as Date) > displayStart)
            .sort((a, c) => (a.start as Date).getTime() - (c.start as Date).getTime())
            .map((b) => {
              const start = clampToDisplay(b.start as Date);
              const end = clampToDisplay(b.end as Date);
              const top = timeToY(start);
              const height = diffMin(start, end) * pxPerMin;
              const done = b.status === 'done';
              const active = b.status === 'active';

              const cardBase =
                'absolute rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer';
              const cardTone = toneForBox(b);
              const enableMove = height >= 30; // 15分钟(30px)及以上可拖动

              return (
                <div
                  key={b.id}
                  data-box="true"
                  onClick={() => onSelectBox?.(b)}
                  className={`${cardBase} ${cardTone} ${
                    selectedBoxId === b.id ? 'ring-2 ring-blue-400/60 shadow-lg' : ''
                  } ${done ? 'opacity-70' : ''}`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    left: LABEL_COL_WIDTH + CONTENT_LEFT_PAD,
                    right: CONTENT_RIGHT_PAD,
                    ...(b.color ? { borderColor: b.color, borderWidth: 1, borderStyle: 'solid' } : {}),
                  }}
                >
                  {/* 左侧拖拽区域 */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-8 ${
                      enableMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    }`}
                    onPointerDown={enableMove ? (e) => startMove(b, e) : undefined}
                    title={enableMove ? "拖拽移动" : ""}
                  />
                  
                  {/* 中右侧点击区域 */}
                  <div
                    className="absolute left-8 top-0 bottom-0 right-0 cursor-pointer"
                    onClick={() => onSelectBox?.(b)}
                  />

                  <div className="flex items-center justify-between px-2 py-1 relative z-10 pointer-events-none">
                    <div className="flex items-center gap-2">
                      <div className={`text-sm font-medium truncate ${done ? 'line-through' : ''} text-slate-800`}>
                        {b.title} {b.is_plan_session ? <span className="text-blue-600">(计划盒)</span> : null}
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          active
                            ? 'status-active'
                            : done
                            ? 'status-done'
                            : b.status === 'missed'
                            ? 'status-urgent'
                            : 'status-planned'
                        }`}
                      >
                        {active ? '进行中' : done ? '已完成' : b.status === 'missed' ? '未完成' : '已计划'}
                      </span>
                    </div>

                    {selectedBoxId === b.id ? (
                      <div className="flex gap-1 pointer-events-auto" data-interactive="true">
                        {b.status === 'planned' ? (
                          <>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await startBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors duration-200"
                              title="开始"
                              disabled={busy}
                            >
                              开始
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await shiftBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors duration-200"
                              title="顺延"
                              disabled={busy}
                            >
                              顺延
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await finishBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors duration-200"
                              title="删除"
                              disabled={busy}
                            >
                              删除
                            </button>
                          </>
                        ) : b.status === 'active' ? (
                          <>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await finishBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-200"
                              title="完成"
                              disabled={busy}
                            >
                              完成
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await splitActiveBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200"
                              title="分割"
                              disabled={busy}
                            >
                              分割
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await deleteBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors duration-200"
                              title="删除"
                              disabled={busy}
                            >
                              删除
                            </button>
                          </>
                        ) : b.status === 'missed' ? (
                          <>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await shiftBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors duration-200"
                              title="顺延到下一空窗"
                              disabled={busy}
                            >
                              顺延
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusy(true);
                                try {
                                  await deleteBox(b.id);
                                  await onChanged();
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors duration-200"
                              title="删除"
                              disabled={busy}
                            >
                              删除
                            </button>
                          </>
                        ) : (
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setBusy(true);
                              try {
                                await deleteBox(b.id);
                                await onChanged();
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="px-2 py-1 text-[10px] rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors duration-200"
                            title="删除"
                            disabled={busy}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div
                    data-resize="true"
                    className="absolute left-0 right-0 h-3 bottom-0 cursor-ns-resize bg-gradient-to-t from-slate-200/60 to-transparent rounded-b-2xl hover:from-slate-300/80 transition-colors duration-200"
                    onPointerDown={(e) => startResize(b, e)}
                    onClick={(e) => e.stopPropagation()}
                    title="拖拽调整时长"
                  />
                </div>
              );
            })}

            {/* 移动预览 */}
            {moving && draftStart && draftEnd && (
              <>
                <div
                  className={`absolute z-50 pointer-events-none border-2 ${
                    liveConflict ? 'border-red-500/70 bg-red-300/5' : 'border-blue-500/70 bg-blue-300/5'
                  } border-dashed rounded`}
                  style={{
                    top: `${timeToY(draftStart)}px`,
                    height: `${diffMin(draftStart, draftEnd) * pxPerMin}px`,
                    left: LABEL_COL_WIDTH + CONTENT_LEFT_PAD,
                    right: CONTENT_RIGHT_PAD,
                  }}
                />
                {/* 顶部标尺线 + 开始时间（不进入标签列） */}
                <div
                  className="absolute z-50 pointer-events-none"
                  style={{ top: `${timeToY(draftStart)}px`, height: 0, left: LABEL_COL_WIDTH, right: 0 }}
                >
                  <div className={`border-t-2 ${liveConflict ? 'border-red-500' : 'border-blue-500'}`}></div>
                  <div
                    className={`absolute -top-3 left-2 text-[10px] px-2 py-0.5 rounded-full ${liveConflict ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'} shadow`}
                  >
                    {formatHM(draftStart)}
                  </div>
                </div>
                {/* 底部标尺线 + 结束时间 + 总分钟数（不进入标签列） */}
                <div
                  className="absolute z-50 pointer-events-none"
                  style={{ top: `${timeToY(draftEnd)}px`, height: 0, left: LABEL_COL_WIDTH, right: 0 }}
                >
                  <div className={`border-t-2 ${liveConflict ? 'border-red-500' : 'border-blue-500'}`}></div>
                  <div
                    className={`absolute -top-3 right-2 text-[10px] px-2 py-0.5 rounded-full ${liveConflict ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'} shadow`}
                  >
                    {formatHM(draftEnd)} · {diffMin(draftStart, draftEnd)}min{liveConflict ? ' · 冲突' : ''}
                  </div>
                </div>
              </>
            )}

            {/* 拉伸预览（仅在内容区显示） */}
            {resizing && draftEnd && (
              <>
                <div
                  className={`absolute z-50 pointer-events-none border-2 ${
                    liveConflict ? 'border-red-500/70 bg-red-300/5' : 'border-blue-500/70 bg-blue-300/5'
                  } border-dashed rounded`}
                  style={{
                    top: `${timeToY(resizing.start)}px`,
                    height: `${diffMin(resizing.start, draftEnd) * pxPerMin}px`,
                    left: LABEL_COL_WIDTH + CONTENT_LEFT_PAD,
                    right: CONTENT_RIGHT_PAD,
                  }}
                />
                <div
                  className="absolute z-50 pointer-events-none"
                  style={{ top: `${timeToY(resizing.start)}px`, height: 0, left: LABEL_COL_WIDTH, right: 0 }}
                >
                  <div className={`border-t-2 ${liveConflict ? 'border-red-500' : 'border-blue-500'}`}></div>
                  <div
                    className={`absolute -top-3 left-2 text-[10px] px-2 py-0.5 rounded-full ${liveConflict ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'} shadow`}
                  >
                    {formatHM(resizing.start)}
                  </div>
                </div>
                <div
                  className="absolute z-50 pointer-events-none"
                  style={{ top: `${timeToY(draftEnd)}px`, height: 0, left: LABEL_COL_WIDTH, right: 0 }}
                >
                  <div className={`border-t-2 ${liveConflict ? 'border-red-500' : 'border-blue-500'}`}></div>
                  <div
                    className={`absolute -top-3 right-2 text-[10px] px-2 py-0.5 rounded-full ${liveConflict ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'} shadow`}
                  >
                    {formatHM(draftEnd)} · {diffMin(resizing.start, draftEnd)}min{liveConflict ? ' · 冲突' : ''}
                  </div>
                </div>
              </>
            )}

            {/* 冲突弹窗：改为大圆角卡片 */}
            {conflict && (
              <div className="absolute inset-0 z-50" onPointerDown={(e) => { e.stopPropagation(); setConflict(null); }}>
                <div
                  className="absolute right-3 bg-white/95 backdrop-blur-sm rounded-3xl shadow-xl p-4 text-sm border border-slate-200/60"
                  style={{ top: `${(conflictPopoverY ?? timeToY(conflict.end))}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="font-semibold mb-1 text-slate-800">时间冲突</div>
                  <div className="text-xs text-slate-600 mb-3">
                    {formatHM(conflict.start)} — {formatHM(conflict.end)}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1.5 text-xs rounded-full bg-amber-500 text-white hover:bg-amber-600 transition-colors duration-200 font-medium"
                      onClick={moveConflictToNextFreeSlot}
                      title="自动移动到当下一空窗"
                    >
                      移到下一空窗
                    </button>
                    <button
                      className="px-3 py-1.5 text-xs rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-200 font-medium"
                      onClick={async () => {
                        await finalizeUpdate(conflict.boxId, conflict.start, conflict.end);
                        setConflict(null);
                      }}
                    >
                      仍然保存
                    </button>
                    <button
                      className="px-3 py-1.5 text-xs rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors duration-200 font-medium"
                      onClick={() => setConflict(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}