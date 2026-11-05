/** Stable display-facing v1 contract facade. */
export type * from './protocol.js';

/** Additive v1.1 event types only; no logging behavior is implemented. */
export type Confidence = 'possible' | 'probable' | 'certain';
export type LogEventType = 'contact' | 'classification' | 'buoyDrop' | 'buoyLive' | 'buoyDead' | 'bearing' | 'note';
export interface LogEvent { v: 1.1 | 1; type: 'log'; simT: number; kind: LogEventType; category?: 'surface' | 'subsurface'; contactId?: number; buoyId?: number; class?: string; confidence?: Confidence; data?: Record<string, unknown>; }

/** v1.1 operator-editable scenario generation inputs; no transport behavior implied. */
export type {ScenarioParams,Difficulty} from './scenario/presets.js';
