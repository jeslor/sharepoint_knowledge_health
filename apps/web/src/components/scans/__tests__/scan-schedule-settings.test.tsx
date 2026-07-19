import { render, screen, fireEvent } from '@testing-library/react';
import type { ScanScheduleResponse } from '@sph/types';
import { ScanScheduleSettings } from '../scan-schedule-settings';

const mockSave = jest.fn();
let mockSchedule: ScanScheduleResponse | null | undefined;
let mockLoading = false;

jest.mock('@/lib/api/hooks/use-scan-schedule', () => ({
  useScanSchedule: () => ({
    schedule: mockSchedule,
    loading: mockLoading,
    error: undefined,
    save: mockSave,
    saving: false,
    saveError: undefined,
  }),
}));

describe('ScanScheduleSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoading = false;
    mockSchedule = undefined;
  });

  it('renders a loading state while the schedule is being fetched', () => {
    mockLoading = true;
    render(<ScanScheduleSettings canManage />);

    expect(screen.getByText('Loading schedule…')).toBeInTheDocument();
  });

  it('shows "Not scheduled" and an "Enable scheduling" call to action when no schedule exists yet', () => {
    mockSchedule = null;
    render(<ScanScheduleSettings canManage />);

    expect(screen.getByText('Not scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable scheduling/i })).toBeInTheDocument();
  });

  it('renders the current schedule\'s next run time and an "Update schedule" call to action', () => {
    mockSchedule = {
      id: 'schedule-1',
      frequency: 'Weekly',
      enabled: true,
      nextRunAt: '2026-07-20T02:00:00.000Z',
      lastRunAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    render(<ScanScheduleSettings canManage />);

    expect(screen.getByRole('button', { name: /update schedule/i })).toBeInTheDocument();
    expect(screen.queryByText('Not scheduled')).not.toBeInTheDocument();
  });

  it('calls save() with the selected frequency and enabled state when the button is clicked', () => {
    mockSchedule = {
      id: 'schedule-1',
      frequency: 'Weekly',
      enabled: true,
      nextRunAt: '2026-07-20T02:00:00.000Z',
      lastRunAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    render(<ScanScheduleSettings canManage />);

    fireEvent.click(screen.getByRole('combobox', { name: /frequency/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Daily' }));
    fireEvent.click(screen.getByRole('button', { name: /update schedule/i }));

    expect(mockSave).toHaveBeenCalledWith({ frequency: 'Daily', enabled: true });
  });

  it('toggling "Automatic scans" to Disabled and saving passes enabled: false', () => {
    mockSchedule = {
      id: 'schedule-1',
      frequency: 'Daily',
      enabled: true,
      nextRunAt: '2026-07-14T00:00:00.000Z',
      lastRunAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    render(<ScanScheduleSettings canManage />);

    fireEvent.click(screen.getByRole('combobox', { name: /automatic scans/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Disabled' }));
    fireEvent.click(screen.getByRole('button', { name: /update schedule/i }));

    expect(mockSave).toHaveBeenCalledWith({ frequency: 'Daily', enabled: false });
  });

  it('hides the edit form and shows a read-only summary when canManage is false', () => {
    mockSchedule = {
      id: 'schedule-1',
      frequency: 'Weekly',
      enabled: true,
      nextRunAt: '2026-07-20T02:00:00.000Z',
      lastRunAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    render(<ScanScheduleSettings canManage={false} />);

    expect(screen.queryByRole('button', { name: /update schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/frequency/i)).not.toBeInTheDocument();
    expect(screen.getByText(/enabled/i)).toBeInTheDocument();
  });
});
