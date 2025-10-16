export type BoxStatus = 'planned' | 'active' | 'done' | 'missed';
export type EnergyLevel = 'low' | 'medium' | 'high';

export interface Box {
  id: string;
  title: string;
  start: Date;
  end: Date;
  status: BoxStatus;
  tags?: string[];
  color?: string;
  energy?: EnergyLevel;
  location?: string;
  notes?: string;
  links?: Record<string, unknown>;
  is_plan_session?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BacklogItem {
  id: string;
  title: string;
  notes?: string;
  tags?: string[];
  estimate_min?: number;
}

export type LogEvent =
  | 'create'
  | 'start'
  | 'pause'
  | 'resume'
  | 'done'
  | 'extend'
  | 'split'
  | 'snooze'
  | 'shift'
  | 'delete'
  | 'update';

export interface LogEntry {
  id: string;
  box_id: string;
  event: LogEvent;
  payload?: Record<string, unknown>;
  created_at: Date;
}

export interface Settings {
  id: 'singleton';
  planning_default_minutes: number;
  meeting_prep_min: number;
  focus_shield: boolean;
  workday_start: string; // 'HH:MM'
  workday_end: string;   // 'HH:MM'
  colors_by_tag?: Record<string, string>;
  calendar_integration_enabled?: boolean;
}