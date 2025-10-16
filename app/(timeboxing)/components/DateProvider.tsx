'use client';

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

type DateContextValue = {
  selectedDate: Date;
  setDate: (d: Date) => void;
  goToToday: () => void;
  formatForInput: (d?: Date) => string;
};

const DateContext = createContext<DateContextValue | undefined>(undefined);

function toInputYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DateProvider({ children }: { children: React.ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const setDate = useCallback((d: Date) => setSelectedDate(d), []);
  const goToToday = useCallback(() => setSelectedDate(new Date()), []);
  const formatForInput = useCallback((d?: Date) => toInputYMD(d ?? selectedDate), [selectedDate]);

  const value = useMemo(
    () => ({ selectedDate, setDate, goToToday, formatForInput }),
    [selectedDate, goToToday, formatForInput]
  );

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>;
}

export function useDate() {
  const ctx = useContext(DateContext);
  if (!ctx) throw new Error('useDate must be used within DateProvider');
  return ctx;
}