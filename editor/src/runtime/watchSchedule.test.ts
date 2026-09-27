import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ScheduleState } from '@/api/client';
import { watchSchedule } from './watchSchedule';

const ticking = { scheduled: true, runs: 0 } as unknown as ScheduleState;
const still = { scheduled: false, runs: 0 } as unknown as ScheduleState;

afterEach(() => { vi.useRealTimers(); });

describe('a tool page watching its clock', () => {
  it('goes on watching after a question the server did not answer (B36)', async () => {
    vi.useFakeTimers();
    const answers: (() => Promise<ScheduleState>)[] = [
      () => Promise.reject(new Error('restarting')),
      () => Promise.resolve({ ...ticking, runs: 1 }),
      () => Promise.resolve({ ...ticking, runs: 2 }),
    ];
    const seen: number[] = [];
    const stop = watchSchedule(() => answers.shift()!(), (state) => seen.push(state.runs), 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    expect(seen).toEqual([1, 2]);
  });

  it('asks once when nothing is scheduled, and not at all once stopped', async () => {
    vi.useFakeTimers();
    const ask = vi.fn(async () => still);
    watchSchedule(ask, () => {}, 2000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ask).toHaveBeenCalledTimes(1);

    const again = vi.fn(async () => ticking);
    const stop = watchSchedule(again, () => {}, 2000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(again).toHaveBeenCalledTimes(1);
  });
});
