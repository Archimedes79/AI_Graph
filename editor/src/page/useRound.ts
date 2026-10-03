import { useRef, useState } from 'react';
import type { Requirement } from '@/api/client';
import { requirementsFor, startRound, useSession } from '@/api/session';

/**
 * Starting a round the way every page starts one.
 *
 * Three hosts draw a page in use -- `runtime/RuntimeApp.tsx` for a tool
 * someone was handed, the editor's running application, and the editor's Page
 * tab, whose blocks are live -- and ▶ Run starts the rounds of a graph without
 * a page the same way again. A round from any of them has the same two steps:
 * ask what the graph still needs (a file to read, a place to write), and only
 * then start it, with what was set on the page and the answers, by name. The
 * editor's page once had the second step and not the first, so pressing a
 * button there failed on a file nobody had chosen, while the same press in the
 * delivered tool politely asked for it.
 *
 * *before*, given, runs first: the editor hands its document to the server,
 * so the round runs what is being edited. *values* is what the page sends
 * besides what was set on it -- the Page tab's design.
 */
export function useRound(before?: () => Promise<void>, values?: () => Record<string, unknown>) {
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const pending = useRef<{ event: string | null; given: Record<string, unknown> } | null>(null);

  /** Start a round for the event *event* -- the whole graph for none -- once whatever it still needs is answered. */
  const run = async (event: string | null = null) => {
    await before?.();
    const given = { ...values?.(), ...useSession.getState().edits };
    try {
      // For this event: what it does not run is not asked about.
      const needed = await requirementsFor(event, given);
      if (needed.length > 0) {
        pending.current = { event, given };
        setRequirements(needed);
        return;
      }
    } catch {
      // Requirements are an optimisation; if the check fails, just run and let
      // the engine report a missing value properly.
    }
    await startRound(event, given);
  };

  /** The answers, as values by name: kept by the session with the round, so the next one does not ask again. */
  const submit = async (answers: Record<string, string>) => {
    const asked = pending.current;
    pending.current = null;
    setRequirements(null);
    if (asked) await startRound(asked.event, { ...asked.given, ...answers });
  };

  const cancel = () => {
    pending.current = null;
    setRequirements(null);
  };

  return { run, requirements, submit, cancel };
}
