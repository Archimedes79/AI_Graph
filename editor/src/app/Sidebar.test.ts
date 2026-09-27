import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from './Sidebar';
import { NODE_BUILDERS } from '@/elements/registry';
import { showsPage } from '@/document/guiWidgets';

describe('the node palette', () => {
  it('offers every node but the page: a graph has one, and the Page tab makes it with its first block', () => {
    // A page dropped from here was a second way to make it, and a second page
    // one nobody sees -- `check` names it a problem.
    const html = renderToStaticMarkup(createElement(Sidebar, { onAddNode: () => {} }));
    const offered = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
    for (const [type, builder] of Object.entries(NODE_BUILDERS)) {
      const entry = offered.find((button) => button.includes(`<span>${builder.label}</span>`));
      if (showsPage(type)) expect(entry, type).toBeUndefined();
      else expect(entry, type).toContain('draggable="true"');
    }
    expect(offered.some((button) => button.includes('disabled'))).toBe(false);
  });
});
