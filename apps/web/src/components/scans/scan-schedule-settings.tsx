'use client';

import { useEffect, useState } from 'react';
import type { ScanScheduleFrequencyValue } from '@sph/types';
import { useScanSchedule } from '@/lib/api/hooks/use-scan-schedule';

function formatNextRun(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

interface ScanScheduleSettingsProps {
  // Scheduling mutations are Admin-only server-side (ScanScheduleController)
  // — Phase 9.5 hides the edit form for anyone else, but the read-only
  // "Next scan" line stays visible since GET is not role-restricted.
  canManage: boolean;
}

export function ScanScheduleSettings({ canManage }: ScanScheduleSettingsProps): JSX.Element {
  const { schedule, loading, error, save, saving, saveError } = useScanSchedule();
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<ScanScheduleFrequencyValue>('Weekly');

  useEffect(() => {
    if (schedule) {
      setEnabled(schedule.enabled);
      setFrequency(schedule.frequency);
    }
  }, [schedule]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading schedule…</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">Knowledge Health Monitoring</h2>

      {error && <p className="text-sm text-red-700">{error.message}</p>}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col text-sm text-slate-600">
            Automatic scans
            <select
              className="mt-1 rounded-md border border-slate-300 px-2 py-1"
              value={enabled ? 'enabled' : 'disabled'}
              onChange={(event) => setEnabled(event.target.value === 'enabled')}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>

          <label className="flex flex-col text-sm text-slate-600">
            Frequency
            <select
              className="mt-1 rounded-md border border-slate-300 px-2 py-1"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as ScanScheduleFrequencyValue)}
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
            </select>
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save({ frequency, enabled })}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : schedule ? 'Update schedule' : 'Enable scheduling'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          Automatic scans: <span className="font-medium text-slate-900">{schedule?.enabled ? 'Enabled' : 'Disabled'}</span>
          {schedule && <> ({schedule.frequency})</>}
        </p>
      )}

      {saveError && <p className="text-sm text-red-700">{saveError.message}</p>}

      <p className="text-sm text-slate-600">
        Next scan:{' '}
        <span className="font-medium text-slate-900">{schedule ? formatNextRun(schedule.nextRunAt) : 'Not scheduled'}</span>
      </p>
    </div>
  );
}
