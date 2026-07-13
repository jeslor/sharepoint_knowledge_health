// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export type ScanScheduleFrequencyValue = 'Daily' | 'Weekly';

export interface ScanScheduleResponse {
  id: string;
  frequency: ScanScheduleFrequencyValue;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScanScheduleRequest {
  frequency: ScanScheduleFrequencyValue;
  enabled?: boolean;
}

export interface UpdateScanScheduleRequest {
  frequency?: ScanScheduleFrequencyValue;
  enabled?: boolean;
}
