'use client';

import { useDate } from '../components/DateProvider';
import { useEffect, useState } from 'react';
import type { Settings } from '@/lib/types';
import { initDefaultSettings, getSettings, updateSettings } from '@/lib/actions/settings';
import { ensurePlanSessionForDay, getBoxesForDay } from '@/lib/actions/boxes';

export default function SettingsPage() {
  const { selectedDate, formatForInput } = useDate();

  const [boxCount, setBoxCount] = useState(0);
  const [titles, setTitles] = useState<string[]>([]);
  const [settingsPreview, setSettingsPreview] = useState<string>('（未加载）');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  // 顶部短暂提示
  const [toast, setToast] = useState<string | null>(null);
  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 1600);
  }

  async function refreshDayBoxes() {
    const rows = await getBoxesForDay(selectedDate);
    setBoxCount(rows.length);
    setTitles(rows.map((b) => `${b.title} (${b.status})`));
  }

  useEffect(() => {
    // 切换日期时刷新
    refreshDayBoxes();
  }, [selectedDate]);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s);
      setSettingsPreview(JSON.stringify(s));
    })();
  }, []);

  async function handleInitSettings() {
    const s = await initDefaultSettings();
    setSettings(s);
    setSettingsPreview(JSON.stringify(s));
  }

  async function handlePlanSession() {
    await ensurePlanSessionForDay(selectedDate);
    await refreshDayBoxes();
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await updateSettings({
        workday_start: settings.workday_start,
        workday_end: settings.workday_end,
        planning_default_minutes: settings.planning_default_minutes,
        focus_shield: settings.focus_shield,
        calendar_integration_enabled: settings.calendar_integration_enabled,
      });
      setSettings(next);
      setSettingsPreview(JSON.stringify(next));
      showToast('设置已保存');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {toast ? (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-purple-800 text-white text-xs rounded-full px-3 py-2 shadow">
          {toast}
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold mb-2">Settings 设置</h1>
      <p className="text-sm text-gray-600">当前日期：{formatForInput(selectedDate)}</p>

      <div className="mt-4 border rounded-2xl bg-yellow-50/30 p-4">
        <h2 className="text-lg font-medium mb-3">工作日与计划参数</h2>
        {!settings ? (
          <div className="text-sm text-gray-500">正在加载设置……</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-600">工作日开始</label>
              <input
                type="time"
                className="border rounded px-2 py-1 text-sm"
                value={settings.workday_start}
                onChange={(e) => setSettings({ ...settings, workday_start: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-600">工作日结束</label>
              <input
                type="time"
                className="border rounded px-2 py-1 text-sm"
                value={settings.workday_end}
                onChange={(e) => setSettings({ ...settings, workday_end: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-600">每日计划时长（分钟）</label>
              <input
                type="number"
                min={5}
                max={240}
                step={5}
                className="border rounded px-2 py-1 text-sm w-24"
                value={settings.planning_default_minutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    planning_default_minutes: Math.max(5, Math.min(240, parseInt(e.target.value || '0', 10))),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-600">专注保护（屏蔽干扰）</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.focus_shield}
                  onChange={(e) => setSettings({ ...settings, focus_shield: e.target.checked })}
                />
                <span className="text-xs text-gray-500">（后续用于专注模式屏蔽提示）</span>
              </div>
            </div>
            {/* 启用日历集成（已移除） */}
          </div>
        )}
        <div className="mt-3">
          <button
            className="px-3 py-1 rounded-full bg-blue-600 text-white disabled:opacity-50"
            onClick={handleSave}
            disabled={saving || !settings}
          >
            保存设置
          </button>
        </div>
      </div>

      {/* 开发验证面板（保持以便基础联调） */}
      <div className="mt-6 border rounded-2xl bg-yellow-50/30 p-4">
        <h2 className="text-lg font-medium mb-2">数据库验证面板</h2>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 rounded-full bg-purple-800 text-white"
            onClick={handleInitSettings}
          >
            初始化默认设置
          </button>
          <button
            className="px-3 py-1 rounded-full bg-blue-600 text-white"
            onClick={handlePlanSession}
          >
            生成今日计划盒
          </button>
          <button
            className="px-3 py-1 rounded-full bg-gray-200"
            onClick={refreshDayBoxes}
          >
            刷新今日盒子
          </button>
        </div>
        <div className="mt-3 text-sm text-gray-700 space-y-3">
          <div>今日盒子数量：{boxCount}</div>
          <div>
            {titles.length > 0 ? (
              <ul className="list-disc pl-6 space-y-1">
                {titles.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">（暂无数据）</div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-2">设置摘要：</div>
            {!settings ? (
              <div className="text-xs text-gray-400">（未加载）</div>
            ) : (
              <ul className="text-xs text-gray-700 list-disc pl-6 space-y-1">
                <li>工作日：{settings.workday_start} — {settings.workday_end}</li>
                <li>每日计划时长：{settings.planning_default_minutes} 分钟</li>
                <li>专注保护：{settings.focus_shield ? '开启' : '关闭'}</li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}