import type { ScheduleState } from '@/api/client';

/**
 * Watch the tool's clock: ask *ask* now, and every *every* ms after while the
 * server says a clock is running, handing each answer to *seen*. Returns what
 * stops it.
 *
 * A question the server did not answer -- restarting, busy -- is asked again:
 * the page used to stop watching after the first one, and a tool that went on
 * running on its clock showed its first round until the page was reloaded.
 * Nothing scheduled is asked once, and that is the end of it.
 */
export function watchSchedule(
  ask: () => Promise<ScheduleState>,
  seen: (state: ScheduleState) => void,
  every = 2000,
): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = async () => {
    let again = true;
    try {
      const state = await ask();
      if (!alive) return;
      seen(state);
      again = state.scheduled;
    } catch {
      // Asked again below.
    }
    if (alive && again) timer = setTimeout(look, every);
  };
  void look();
  return () => { alive = false; if (timer) clearTimeout(timer); };
}
