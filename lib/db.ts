import Dexie, { Table } from 'dexie';
import type { Box, BacklogItem, LogEntry, Settings } from './types';

class TimeboxingDB extends Dexie {
  boxes!: Table<Box, string>;
  backlog!: Table<BacklogItem, string>;
  logs!: Table<LogEntry, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('timeboxing_db');
    this.version(1).stores({
      boxes:
        'id, start, end, status, is_plan_session, created_at, updated_at, tags*',
      backlog: 'id, title, estimate_min, tags*',
      logs: 'id, box_id, event, created_at',
      settings: 'id',
    });
  }
}

// 只在浏览器环境中初始化数据库
export const db = typeof window !== 'undefined' ? new TimeboxingDB() : null as any;