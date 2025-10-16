'use client';

import AppLayout from '../components/AppLayout';
import { useDate } from '../components/DateProvider';
import { useEffect, useMemo, useState } from 'react';
import type { Box, BacklogItem } from '@/lib/types';
import { getSettings } from '@/lib/actions/settings';
import {
  createBox,
  getBoxesForDay,
  ensurePlanSessionForDay,
  findNextFreeSlot,
  startBox,
  finishBox,
  shiftBox,
  deleteBox,
  splitActiveBox,
  updateBoxMeta,
  extendBox,
  updateBoxTimes,
} from '@/lib/actions/boxes';
import {
  listBacklog,
  createBacklogItem,
  deleteBacklogItem,
  updateBacklogItem,
} from '@/lib/actions/backlog';
import { hasOverlap } from '@/lib/utils/overlap';
import DayCalendar from '../components/DayCalendar';

export default function PlanPage() {
  const { selectedDate, formatForInput } = useDate();

  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dayBoxes, setDayBoxes] = useState<Box[]>([]);
  const [showPlanPrompt, setShowPlanPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  // 上方提示不再影响整体高度，整页使用视口高度并禁用外部滚动
  // 已移除动态高度计算，容器使用 flex-1 min-h-0 控制剩余空间

  // 顶部短暂提示
  const [toast, setToast] = useState<string | null>(null);
  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 1600);
  }

  // 选中盒子（允许 undefined）
  const [selectedBoxId, setSelectedBoxId] = useState<string | undefined>(undefined);
  const selectedBox = useMemo(
    () => dayBoxes.find((b) => b.id === selectedBoxId),
    [dayBoxes, selectedBoxId]
  );

  // 属性面板元数据
  const [metaTitle, setMetaTitle] = useState('');
  const [metaTags, setMetaTags] = useState('');
  const [metaNotes, setMetaNotes] = useState('');

  useEffect(() => {
    if (selectedBox) {
      setMetaTitle(selectedBox.title);
      setMetaTags((selectedBox.tags ?? []).join(' '));
      setMetaNotes(selectedBox.notes ?? '');
    } else {
      setMetaTitle('');
      setMetaTags('');
      setMetaNotes('');
    }
  }, [selectedBox]);

  // 基于选中盒子与当前输入的脏检查（用于禁用“保存属性”）
  const isMetaDirty = useMemo(() => {
    if (!selectedBox) return false;
    const tagsStr = (selectedBox.tags ?? []).join(' ');
    return (
      metaTitle !== selectedBox.title ||
      metaNotes !== (selectedBox.notes ?? '') ||
      metaTags.trim() !== tagsStr.trim()
    );
  }, [selectedBox, metaTitle, metaTags, metaNotes]);

  // 手动添加待办：输入标题与预估分钟数（字符串态，便于清理前导 0）
  const [newTitle, setNewTitle] = useState('');
  const [newEstimateText, setNewEstimateText] = useState('30');
  const newEstimate = useMemo(() => {
    const n = parseInt(newEstimateText, 10);
    return Number.isFinite(n) ? n : 0;
  }, [newEstimateText]);

  // 行内编辑状态（用于“编辑”）
  const [editingBacklogId, setEditingBacklogId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editEstimateText, setEditEstimateText] = useState('');
  const editEstimate = useMemo(() => {
    const n = parseInt(editEstimateText, 10);
    return Number.isFinite(n) ? n : 0;
  }, [editEstimateText]);

  // 仅在点击该事项时显示操作按钮的行状态
  const [actionRowId, setActionRowId] = useState<string | null>(null);


  // 延长冲突弹窗状态（属性面板）
  const [extendConflict, setExtendConflict] = useState(false);
  const [extendDraft, setExtendDraft] = useState<{
    boxId: string;
    title: string;
    prevStart: Date;
    prevEnd: Date;
    nextEnd: Date;
    minutes: number;
  } | null>(null);

  const selectedDurationMin = useMemo(() => {
    if (!selectedBox) return 0;
    return Math.round((selectedBox.end.getTime() - selectedBox.start.getTime()) / 60000);
  }, [selectedBox]);

  async function refreshBacklog() {
    const items = await listBacklog();
    setBacklog(items);
  }

  async function refreshDayBoxes() {
    const rows = await getBoxesForDay(selectedDate);
    setDayBoxes(rows);
  }

  useEffect(() => {
    refreshBacklog();
    refreshDayBoxes();
  }, []);

  useEffect(() => {
    (async () => {
      await refreshDayBoxes();
      const hasPlan = dayBoxes.some((b) => b.is_plan_session === true);
      setShowPlanPrompt(!hasPlan);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    const hasPlan = dayBoxes.some((b) => b.is_plan_session === true);
    setShowPlanPrompt(!hasPlan);
  }, [dayBoxes]);

  async function handleCreatePlanSession() {
    setBusy(true);
    try {
      await ensurePlanSessionForDay(selectedDate);
      await refreshDayBoxes();
      setShowPlanPrompt(false);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // 批量安排到今天（紧急 > 重要 > 一般）
  async function arrangeSelectedToToday() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const settings = await getSettings();
      let anchor = new Date(selectedDate);
      const [h, m] = settings.workday_start.split(':').map((v) => parseInt(v, 10));
      anchor.setHours(h, m, 0, 0);

      const selectedItems = backlog.filter((b) => selectedIds.includes(b.id));

      function urgencyRank(tags?: string[]): number {
        if (!tags || tags.length === 0) return 1; // 默认“重要”
        const norm = tags.map((t) => t.trim().toLowerCase());
        const hasUrgent = norm.some((t) =>
          ['#紧急', '紧急', '#urgent', 'urgent', 'high', '#high'].includes(t)
        );
        const hasImportant = norm.some((t) =>
          ['#重要', '重要', '#中', '中', '#medium', 'medium', '#important', 'important'].includes(t)
        );
        const hasNormal = norm.some((t) =>
          ['#一般', '一般', '#低', '低', '#normal', 'normal', 'low', '#low'].includes(t)
        );
        if (hasUrgent) return 2;
        if (hasImportant) return 1;
        if (hasNormal) return 0;
        return 1;
      }
      selectedItems.sort((a, b) => urgencyRank(b.tags) - urgencyRank(a.tags));

      for (const item of selectedItems) {
        const minutes = item.estimate_min ?? 30;
        const slot = await findNextFreeSlot(selectedDate, minutes, anchor);
        if (!slot) continue;

        // 未标注时默认补“#重要”
        const tags = Array.isArray(item.tags) ? [...item.tags] : [];
        const rank = urgencyRank(tags);
        const hasRank = rank === 2 || rank === 1 || rank === 0;
        if (!hasRank) tags.push('#重要');

        await createBox({
          title: item.title,
          start: slot.start,
          end: slot.end,
          status: 'planned',
          tags,
          notes: item.notes,
          is_plan_session: false,
        });
        anchor = slot.end;
      }
      await refreshDayBoxes();
      setSelectedIds([]);
    } finally {
      setBusy(false);
    }
  }

  async function handleBoxAction(
    id: string,
    action: 'start' | 'finish' | 'shift' | 'delete' | 'split'
  ) {
    setBusy(true);
    try {
      if (action === 'start') await startBox(id);
      if (action === 'finish') await finishBox(id);
      if (action === 'shift') await shiftBox(id);
      if (action === 'delete') await deleteBox(id);
      if (action === 'split') await splitActiveBox(id);
      await refreshDayBoxes();
    } finally {
      setBusy(false);
    }
  }

  // 统一冲突检测
  function hasConflict(start: Date, end: Date, excludeId?: string): boolean {
    return hasOverlap(start, end, dayBoxes, excludeId);
  }

  // 快速延长选中盒子的时长（接入冲突弹窗）
  async function handleExtend(minutes: number) {
    if (!selectedBox) return;
    const nextEnd = new Date(selectedBox.end.getTime() + minutes * 60000);

    if (hasConflict(selectedBox.start, nextEnd, selectedBox.id)) {
      setExtendDraft({
        boxId: selectedBox.id,
        title: selectedBox.title,
        prevStart: selectedBox.start,
        prevEnd: selectedBox.end,
        nextEnd,
        minutes,
      });
      setExtendConflict(true);
      return;
    }

    setBusy(true);
    try {
      await extendBox(selectedBox.id, minutes);
      await refreshDayBoxes();
    } finally {
      setBusy(false);
    }
  }

  async function confirmExtend() {
    if (!extendDraft) return;
    setBusy(true);
    try {
      await extendBox(extendDraft.boxId, extendDraft.minutes);
      await refreshDayBoxes();
    } finally {
      setBusy(false);
      setExtendConflict(false);
      setExtendDraft(null);
    }
  }

  // 一键解决冲突，移动到下一空窗（以候选结束时间为锚点）
  async function moveExtendConflictToNextFreeSlot() {
    if (!extendDraft) return;
    const duration = Math.round(
      (extendDraft.nextEnd.getTime() - extendDraft.prevStart.getTime()) / 60000
    );
    setBusy(true);
    try {
      const slot = await findNextFreeSlot(selectedDate, duration, extendDraft.nextEnd);
      if (!slot) {
        alert('今日无可用空窗可解决冲突');
      } else {
        await updateBoxTimes(extendDraft.boxId, slot.start, slot.end);
        await refreshDayBoxes();
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

  // 快速缩短选中盒子的时长
  async function handleShorten(minutes: number) {
    if (!selectedBox) return;
    const nextEnd = new Date(selectedBox.end.getTime() - minutes * 60000);
    if (nextEnd <= selectedBox.start) return;

    setBusy(true);
    try {
      await updateBoxTimes(selectedBox.id, selectedBox.start, nextEnd);
      await refreshDayBoxes();
    } finally {
      setBusy(false);
    }
  }

  // 属性面板：紧急程度（改为 紧急/重要/一般）
  function applyUrgency(level: 'urgent' | 'important' | 'normal') {
    const src = metaTags.split(/\s+/).filter(Boolean);
    const syn = new Set(
      [
        '#紧急','紧急','#urgent','urgent','high','#high',
        '#重要','重要','#中','中','#medium','medium','#important','important',
        '#一般','一般','#低','低','#normal','normal','low','#low',
      ].map((t) => t.toLowerCase())
    );
    const removed = src.filter((t) => !syn.has(t.trim().toLowerCase()));
    const add = level === 'urgent' ? '#紧急' : level === 'important' ? '#重要' : '#一般';

    // 更新输入框文本
    setMetaTags([...removed, add].join(' '));
    const label = level === 'urgent' ? '紧急' : level === 'important' ? '重要' : '一般';
    showToast(`已设置紧急程度为 ${label}`);

    // 即时预览：仅本地更新选中盒子的 tags，让日历立即变色
    if (selectedBox) {
        const newTags = [...removed, add];
        setDayBoxes((prev) =>
            prev.map((b) => (b.id === selectedBox.id ? { ...b, tags: newTags } : b))
        );
    }
  }

  async function handleSaveMeta() {
    if (!selectedBox) return;
    const nextTags = metaTags.split(/\s+/).filter(Boolean);
    const prevTagsStr = (selectedBox.tags ?? []).join(' ');
    const same =
      metaTitle === selectedBox.title &&
      metaNotes === (selectedBox.notes ?? '') &&
      nextTags.join(' ') === prevTagsStr;
    if (same) {
      showToast('无改动');
      return;
    }
    setBusy(true);
    try {
      await updateBoxMeta(selectedBox.id, {
        title: metaTitle,
        notes: metaNotes,
        tags: nextTags,
      });
      await refreshDayBoxes();
      showToast('属性已保存');
    } finally {
      setBusy(false);
    }
  }

  // 手动添加待办事项（含范围校验与提示）
  async function handleManualAdd() {
    const title = newTitle.trim();
    if (!title) return;
    if (newEstimate < 5 || newEstimate > 480) {
      alert('请输入 5–480 分钟');
      return;
    }
    setBusy(true);
    try {
      await createBacklogItem({ title, estimate_min: newEstimate });
      await refreshBacklog();
      setNewTitle('');
      setNewEstimateText('30');
    } finally {
      setBusy(false);
    }
  }

  // 单项安排到今天
  async function arrangeItemToToday(item: BacklogItem) {
    setBusy(true);
    try {
      const settings = await getSettings();
      const anchor = new Date(selectedDate);
      const [h, m] = settings.workday_start.split(':').map((v) => parseInt(v, 10));
      anchor.setHours(h, m, 0, 0);

      const minutes = item.estimate_min ?? 30;
      const slot = await findNextFreeSlot(selectedDate, minutes, anchor);
      if (!slot) {
        alert('今日无可用空窗安排该待办');
        return;
      }
      await createBox({
        title: item.title,
        start: slot.start,
        end: slot.end,
        status: 'planned',
        tags: Array.isArray(item.tags) ? item.tags : [],
        notes: item.notes,
        is_plan_session: false,
      });
      await refreshDayBoxes();
    } finally {
      setBusy(false);
    }
  }

  // 批量设置选中待办的紧急程度（重要/紧急/一般）
  async function applyUrgencyToSelected(level: 'urgent' | 'important' | 'normal') {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const syn = new Set(
        [
          '#紧急',
          '紧急',
          '#urgent',
          'urgent',
          'high',
          '#high',
          '#重要',
          '重要',
          '#中',
          '中',
          '#medium',
          'medium',
          '#important',
          'important',
          '#一般',
          '一般',
          '#低',
          '低',
          '#normal',
          'normal',
          'low',
          '#low',
        ].map((t) => t.toLowerCase())
      );
      const add = level === 'urgent' ? '#紧急' : level === 'important' ? '#重要' : '#一般';

      for (const id of selectedIds) {
        const item = backlog.find((b) => b.id === id);
        if (!item) continue;
        const src = Array.isArray(item.tags) ? [...item.tags] : [];
        const removed = src.filter((t) => !syn.has(t.trim().toLowerCase()));
        await updateBacklogItem(id, { tags: [...removed, add] });
      }
      await refreshBacklog();
      const label = level === 'urgent' ? '紧急' : level === 'important' ? '重要' : '一般';
      showToast(`已更新 ${selectedIds.length} 项为「${label}」`);
    } finally {
      setBusy(false);
    }
  }

  // （此处原有 adjustEstimateSelected 已移除）

  // 行内编辑（开始/取消/保存）
  function startEditBacklog(item: BacklogItem) {
    setEditingBacklogId(item.id);
    setEditTitle(item.title);
    setEditEstimateText(String(item.estimate_min ?? 30));
  }
  function cancelEditBacklog() {
    setEditingBacklogId(null);
    setEditTitle('');
    setEditEstimateText('');
  }
  async function saveEditBacklog() {
    if (!editingBacklogId) return;
    const title = editTitle.trim();
    if (!title) {
      alert('标题不能为空');
      return;
    }
    if (editEstimate < 5 || editEstimate > 480) {
      alert('请输入 5–480 分钟');
      return;
    }
    setBusy(true);
    try {
      await updateBacklogItem(editingBacklogId, { title, estimate_min: editEstimate });
      await refreshBacklog();
      cancelEditBacklog();
    } finally {
      setBusy(false);
    }
  }

  // 键盘快捷键：编辑态 Enter=保存 / Esc=取消；展开行 Esc=收起 / Delete=删除 / E=编辑
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (editingBacklogId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditBacklog();
          setActionRowId(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          await saveEditBacklog();
          setActionRowId(null);
        }
        return;
      }

      if (!actionRowId) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setActionRowId(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const item = backlog.find((b) => b.id === actionRowId);
        if (!item) return;
        if (confirm('确认删除该待办？')) {
          setBusy(true);
          try {
            await deleteBacklogItem(item.id);
            await refreshBacklog();
          } finally {
            setBusy(false);
            setActionRowId(null);
          }
        }
        return;
      }

      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const item = backlog.find((b) => b.id === actionRowId);
        if (item) startEditBacklog(item);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionRowId, editingBacklogId, backlog]);

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <h1 className="text-2xl font-semibold mb-2">Plan 计划</h1>
        <p className="text-sm text-gray-600">当前日期：{formatForInput(selectedDate)}</p>

      {toast ? (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-purple-800 text-white text-xs rounded-full px-3 py-2 shadow">
          {toast}
        </div>
      ) : null}

      {/* 计划盒弹窗（上方提示） */}
      {showPlanPrompt && (
        <div className="mt-3 mb-4 border rounded-2xl bg-blue-50 p-3 text-sm">
          <div className="font-medium mb-1">创建今日计划盒（建议 15–30 分钟，放在工作日开始）</div>
          <div className="flex gap-2">
            <button
                className="px-3 py-1 rounded-full bg-blue-600 text-white disabled:opacity-50"
                onClick={handleCreatePlanSession}
                disabled={busy}
              >
                创建计划盒
              </button>
              <button
                className="px-3 py-1 rounded-full bg-gray-200"
                onClick={() => setShowPlanPrompt(false)}
              >
                今日忽略
              </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[18rem_1fr_18rem] gap-4 mt-4 flex-1 min-h-0">
        {/* 左栏 待办事项 */}
        <div className="border rounded-2xl bg-yellow-50/30 p-3 h-full min-h-0 overflow-y-auto flex flex-col"
          onClick={() => setActionRowId(null)} // 点击面板空白处收起当前行按钮
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">待办事项</div>
            <div className="flex gap-2">
              <button
                className="px-2 py-1 text-xs rounded-full bg-blue-600 text-white disabled:opacity-50"
                onClick={arrangeSelectedToToday}
                disabled={busy || selectedIds.length === 0}
                title="将选中待办按空窗安排到今天"
              >
                安排到今天
              </button>
            </div>
          </div>


          {/* 手动添加待办（两行布局） */}
          <div className="mb-2 space-y-2">
            <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="待办标题（必填）"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  className="w-24 border rounded px-2 py-1 text-sm pr-8"
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={5}
                  max={480}
                  step={5}
                  value={newEstimateText}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const digits = raw.replace(/\D+/g, '');
                    const cleaned = digits.replace(/^0+(?=\d)/, '');
                    setNewEstimateText(cleaned);
                  }}
                  onBlur={(e) => {
                    const n = parseInt(e.target.value || '0', 10);
                    if (!Number.isFinite(n) || n < 5) {
                      alert('最小值为 5 分钟');
                      setNewEstimateText('5');
                      return;
                    }
                    if (n > 480) {
                      alert('最大值为 480 分钟');
                      setNewEstimateText('480');
                      return;
                    }
                    setNewEstimateText(String(n));
                  }}
                  title="预估分钟数（5–480）"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                  分钟
                </span>
              </div>
              <button
                className="px-2 py-1 text-xs rounded-full bg-gray-200 disabled:opacity-50"
                onClick={handleManualAdd}
                disabled={busy || newTitle.trim() === '' || newEstimate < 5 || newEstimate > 480}
              >
                添加
              </button>
            </div>
          </div>

          {/* 批量紧急程度（作用于当前选中项） */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-gray-600">批量设置紧急程度：</span>
            <button
              className="px-2 py-1 text-xs rounded-full bg-yellow-600 text-white disabled:opacity-50"
              onClick={() => applyUrgencyToSelected('important')}
              disabled={busy || selectedIds.length === 0}
            >
              重要
            </button>
            <button
                className="px-2 py-1 text-xs rounded-full bg-rose-600 text-white disabled:opacity-50"
                onClick={() => applyUrgencyToSelected('urgent')}
                disabled={busy || selectedIds.length === 0}
              >
                紧急
              </button>
            <button
              className="px-2 py-1 text-xs rounded-full bg-emerald-600 text-white disabled:opacity-50"
              onClick={() => applyUrgencyToSelected('normal')}
              disabled={busy || selectedIds.length === 0}
            >
              一般
            </button>
          </div>

          {/* 列表 */}
          <div className="mt-2 space-y-1 flex-1 overflow-y-auto">
            {backlog.map((item) => {
              const checked = selectedIds.includes(item.id);
              const isEditing = editingBacklogId === item.id;
              const showActions = !isEditing && actionRowId === item.id;

              return (
                <div
                  key={item.id}
                  data-row="true"
                  className={
                    'grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 ' +
                    (checked || actionRowId === item.id ? 'bg-blue-50' : '')
                  }
                >
                  {/* 左侧复选框 */}
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={checked}
                    onChange={() => toggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* 中间内容（点击展开/收起按钮） */}
                  <div
                    className="flex items-center gap-2 min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionRowId((prev) => (prev === item.id ? null : item.id));
                    }}
                  >
                    {isEditing ? (
                      <>
                        <input
                          className="flex-1 border rounded px-2 py-1 text-sm min-w-0"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="relative">
                          <input
                            className="w-16 shrink-0 border rounded px-1.5 py-1 text-sm pr-6"
                            type="number"
                            inputMode="numeric"
                            min={5}
                            max={480}
                            step={5}
                            value={editEstimateText}
                            onChange={(e) => setEditEstimateText(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            title="预估分钟数（5–480）"
                          />
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 pointer-events-none">
                            分钟
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm truncate">{item.title}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {item.estimate_min ?? 30} 分钟
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 右侧操作（仅当前行显示；移除“安排”按钮） */}
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="px-2 py-0.5 text-[10px] rounded-full bg-blue-600 text-white"
                        onClick={saveEditBacklog}
                        disabled={busy}
                      >
                        保存
                      </button>
                      <button
                        className="px-2 py-0.5 text-[10px] rounded-full bg-gray-200"
                        onClick={cancelEditBacklog}
                      >
                        取消
                      </button>
                    </div>
                  ) : showActions ? (
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="px-2 py-0.5 text-[10px] rounded-full bg-gray-200"
                        onClick={() => {
                          setActionRowId(item.id);
                          startEditBacklog(item);
                        }}
                        title="编辑"
                      >
                        编辑
                      </button>
                      {/* 已移除“安排”按钮 */}
                      <button
                        className="px-2 py-0.5 text-[10px] rounded-full bg-red-600 text-white disabled:opacity-50"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await deleteBacklogItem(item.id);
                            await refreshBacklog();
                          } finally {
                            setBusy(false);
                            setActionRowId(null);
                          }
                        }}
                        disabled={busy}
                        title="删除待办"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <div className="shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 中栏 日历 */}
        <div className="border rounded-2xl bg-yellow-50/30 p-2 h-full min-h-0 overflow-hidden">
          <DayCalendar
            day={selectedDate}
            boxes={dayBoxes}
            onChanged={refreshDayBoxes}
            onSelectBox={(b) => setSelectedBoxId(b?.id)}
            selectedBoxId={selectedBoxId}
          />
        </div>

        {/* 右栏 属性面板 */}
        <div className="border rounded-2xl bg-yellow-50/30 p-3 h-full min-h-0 overflow-y-auto">
            <div className="font-medium mb-2">属性面板</div>
            {!selectedBox ? (
                <div className="text-sm text-gray-600">未选中时间盒</div>
            ) : (
                <div className="space-y-2">
                    <div className="text-xs text-gray-600">时长：{selectedDurationMin} 分钟 · 状态：{
                      selectedBox.status === 'planned' ? '已计划' :
                      selectedBox.status === 'active' ? '进行中' :
                      selectedBox.status === 'done' ? '已完成' :
                      selectedBox.status === 'missed' ? '未完成' :
                      selectedBox.status
                    }
                    </div>

                    {/* 标题 */}
                    <div className="space-y-1">
                        <div className="text-xs text-gray-600">标题</div>
                        <input
                            className="w-full border rounded px-2 py-1 text-sm"
                            value={metaTitle}
                            onChange={(e) => setMetaTitle(e.target.value)}
                        />
                    </div>

                    {/* 标签（空格分隔） */}
                    <div className="space-y-1">
                        <div className="text-xs text-gray-600">标签（空格分隔）</div>
                        <input
                            className="w-full border rounded px-2 py-1 text-sm"
                            value={metaTags}
                            onChange={(e) => setMetaTags(e.target.value)}
                        />
                        <div className="flex gap-2">
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-amber-500 text-white disabled:opacity-50"
                                onClick={() => applyUrgency('important')}
                                disabled={busy}
                            >
                                重要
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-rose-600 text-white disabled:opacity-50"
                                onClick={() => applyUrgency('urgent')}
                                disabled={busy}
                            >
                                紧急
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-emerald-600 text-white disabled:opacity-50"
                                onClick={() => applyUrgency('normal')}
                                disabled={busy}
                            >
                                一般
                            </button>
                        </div>
                    </div>

                    {/* 备注 */}
                    <div className="space-y-1">
                        <div className="text-xs text-gray-600">备注</div>
                        <textarea
                            className="w-full border rounded px-2 py-1 text-sm"
                            rows={3}
                            value={metaNotes}
                            onChange={(e) => setMetaNotes(e.target.value)}
                        />
                    </div>

                    {/* 保存元数据 */}
                    <div className="flex gap-2">
                        <button
                            className="px-3 py-1 text-xs rounded-full bg-blue-600 text-white disabled:opacity-50"
                            onClick={handleSaveMeta}
                            disabled={busy || !isMetaDirty}
                        >
                            保存属性
                        </button>
                    </div>

                    {/* 状态操作（统一中文，两字） */}
                    <div className="space-y-1">
                        <div className="text-xs text-gray-600">状态操作</div>
                        <div className="flex gap-2">
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-green-600 text-white disabled:opacity-50"
                                onClick={() => handleBoxAction(selectedBox.id, 'start')}
                                disabled={busy || selectedBox.status !== 'planned'}
                            >
                                开始
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-purple-800 text-white disabled:opacity-50"
                                onClick={() => handleBoxAction(selectedBox.id, 'finish')}
                                disabled={busy || selectedBox.status === 'done'}
                            >
                                完成
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-red-600 text-white disabled:opacity-50"
                                onClick={() => handleBoxAction(selectedBox.id, 'delete')}
                                disabled={busy}
                            >
                                删除
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-amber-500 text-white disabled:opacity-50"
                                onClick={() => handleBoxAction(selectedBox.id, 'shift')}
                                disabled={busy}
                                title="移动到下一空窗"
                            >
                                顺延
                            </button>
                            <button
                                className="px-2 py-1 text-xs rounded-full bg-indigo-600 text-white disabled:opacity-50"
                                onClick={() => handleBoxAction(selectedBox.id, 'split')}
                                disabled={busy || selectedBox.status !== 'active'}
                                title="拆分进行中的盒子"
                            >
                                分割
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 延长冲突弹窗（属性面板） */}
            {extendConflict && extendDraft ? (
                <div className="mt-3 border rounded-2xl p-2 bg-rose-50">
                    <div className="font-medium mb-1">时间冲突</div>
                    <div className="text-xs text-gray-600 mb-2">
                        [{extendDraft.title}] {extendDraft.prevStart.toLocaleTimeString()} —{' '}
                        {extendDraft.nextEnd.toLocaleTimeString()}
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
                        <button
                            className="px-2 py-1 text-xs rounded-full bg-gray-200"
                            onClick={cancelExtend}
                        >
                            取消
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
      </div>
    </AppLayout>
  );
}