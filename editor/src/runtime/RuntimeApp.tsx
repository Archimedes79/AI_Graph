import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuiWidget } from '@/graph';
import { GuiSurfacePage } from '@/page/GuiPage';
import { useRound } from '@/page/useRound';
import { useSchemeOnRoot } from '@/page/useSchemeOnRoot';
import { pageInUse, type PageDesign } from '@/page/pageInUse';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import DeliveredHeader from '@/page/DeliveredHeader';
import RuntimeAISettings from './RuntimeAISettings';
import { call } from '@/api/client';
import { setEdit, useSession, watchSession } from '@/api/session';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIM, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';

/** Which design of which session: what a drawn page was drawn from. */
const designOf = (session: string, revision: number): string => `${session}#${revision}`;

/**
 * The deployed graph's front-end.
 *
 * It knows the graph only as the runtime API says it: the page as it was
 * designed (`page`), what the graph hands back by name (`interface`), and the
 * session, which the server tells as it changes (`stream`) -- the values each
 * name holds, what each output showed, the round going or gone. A block used
 * sets a value by its name; one that starts the graph starts a round by its
 * name. What using it leaves behind is the server's, so a page reloaded, or
 * opened in a second window, shows what the first one did. The design is
 * loaded again whenever the server holds another one -- the editor's
 * document, edited while the tool is open beside it.
 *
 * Every block is drawn through the component the editor used -- `GuiPage`,
 * each widget's `View` -- so a deployed tool cannot look or behave
 * differently from what was designed.
 *
 * Served by the bundle's `engine/host/serve.ts` at `runtime.html`.
 */
export default function RuntimeApp() {
  const [design, setDesign] = useState<(PageDesign & { startsWhole: boolean; drawn: string }) | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const session = useSession();
  // A deployed tool looks like the thing that was designed, scheme included.
  useSchemeOnRoot(design?.scheme);

  const load = useCallback(() => {
    Promise.all([call('page'), call('interface')])
      .then(([page, offered]) => setDesign({
        name: page.name,
        description: page.description,
        scheme: page.scheme,
        blocks: page.blocks as unknown as GuiWidget[],
        events: offered.events.map(({ name }) => name),
        values: offered.values.map(({ name }) => name),
        outputs: offered.outputs.map(({ name, label }) => ({ name, label })),
        startsWhole: page.starts_whole,
        drawn: designOf(page.session, page.design_revision),
      }))
      .catch((error) => setLoadError(errorText(error, 'Could not load the tool.')));
  }, []);
  useEffect(() => {
    load();
    return watchSession();
  }, [load]);
  // Another design than the one drawn: another session, or this one's edited.
  const held = session.view ? designOf(session.view.session, session.view.design_revision) : null;
  useEffect(() => {
    if (design && held && held !== design.drawn) load();
  }, [design, held, load]);

  // Anything the graph still needs before it can run (a file to read, a place
  // to write) is asked for in the same window the editor uses -- the deployed
  // equivalent of the CLI's stdin prompts, but clickable (`useRound`).
  const round = useRound();

  // Opened, a tool that nothing on its page and no trigger node starts runs
  // whole once, as ▶ Run starts it in the editor and a program runs when it is
  // started. Its trigger nodes are the server's: they run on its clock
  // whether or not a page is open.
  const started = useRef(false);
  const start = useRef(round.run);
  start.current = round.run;
  useEffect(() => {
    if (!design?.startsWhole || started.current) return;
    started.current = true;
    void start.current(null);
  }, [design]);

  const clock = session.view?.clock;
  const finishedAt = session.view?.finished_at;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: SUNKEN }}>
      <DeliveredHeader
        name={design?.name ?? ''}
        description={design?.description ?? ''}
        round={session.round}
        tools={(
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-xs rounded-lg shrink-0"
            style={NEUTRAL_BUTTON}
            title="Point this tool at a different AI"
          >
            ⚙ AI Settings
          </button>
        )}
        note={clock?.runs_by_itself && (
          <span className="text-xs whitespace-nowrap" style={{ color: DIM }} title="This tool runs by itself; the clock is in the server, so it keeps running with this page closed.">
            {session.round && !session.round.done ? '⏱ running…' : clock.next_at
              ? `⏱ next ${new Date(clock.next_at).toLocaleTimeString()}`
              : finishedAt ? `⏱ ran ${new Date(finishedAt).toLocaleTimeString()}` : '⏱'}
          </span>
        )}
      />

      <div className="flex-1 relative overflow-auto">
        {loadError && (
          <div className="m-6 text-sm rounded-lg px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
            {loadError}
          </div>
        )}
        {!loadError && !design && (
          <div className="m-6 text-sm" style={{ color: DIM }}>Loading…</div>
        )}

        {/* The page -- or, when it has no blocks, what the tool does and what
            its run hands back: the editor's running application draws the same. */}
        {design && (
          <GuiSurfacePage
            page={pageInUse(design, session)}
            onValue={(block, value) => setEdit(block.id, value)}
            onEvent={(block) => { void round.run(block.id); }}
          />
        )}
        <RequirementsDialog
          requirements={round.requirements}
          onSubmit={round.submit}
          onCancel={round.cancel}
        />
      </div>

      {showSettings && <RuntimeAISettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
