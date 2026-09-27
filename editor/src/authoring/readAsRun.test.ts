import { describe, it, expect, vi } from 'vitest';
import type { GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';

// What Try it would post, caught instead of posted.
const posted: { route: string; body: Record<string, unknown> }[] = [];
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: Record<string, unknown>) => {
    posted.push({ route, body });
    return { status: 'success', shown: null, error: null };
  }),
}));

const { runBlockAlone } = await import('./readAsRun');

describe('a block run by itself', () => {
  it('says a failure rather than catching it, even where the block catches its failures in a run', async () => {
    // A folder picker told to catch listed a folder that does not exist as
    // "0 files".
    const picker = { ...WIDGET_BUILDERS.input_picker.create('Source', 'directory'), id: 'pick', catch_errors: true } as GuiWidget;
    await runBlockAlone(picker);
    const sent = posted[posted.length - 1];
    expect(sent.route).toBe('runNode');
    const page = (sent.body.nodes as { config: { gui_widgets: GuiWidget[] }; outputs: { id: string }[] }[])[0];
    expect(page.config.gui_widgets[0].catch_errors).toBe(false);
    expect(page.outputs.map((port) => port.id)).not.toContain('pick_error');
  });
});
