'use client';

import { useEffect, useState } from 'react';
import type { ScanScheduleFrequencyValue } from '@sph/types';
import { useScanSchedule } from '@/lib/api/hooks/use-scan-schedule';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

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
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Knowledge Health Monitoring</h2>

      {error && <p className="text-sm text-red-700">{error.message}</p>}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Automatic scans">
            <Select
              value={enabled ? 'enabled' : 'disabled'}
              onChange={(newValue) => setEnabled(newValue === 'enabled')}
              options={[
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
          </Field>

          <Field label="Frequency">
            <Select
              value={frequency}
              onChange={(newValue) => setFrequency(newValue as ScanScheduleFrequencyValue)}
              options={[
                { value: 'Daily', label: 'Daily' },
                { value: 'Weekly', label: 'Weekly' },
              ]}
            />
          </Field>

          <Button disabled={saving} onClick={() => void save({ frequency, enabled })}>
            {saving ? 'Saving…' : schedule ? 'Update schedule' : 'Enable scheduling'}
          </Button>
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
    </Card>
  );
}
