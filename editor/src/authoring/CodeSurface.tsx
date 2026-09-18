import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { LINE } from '@/ui/theme';
import { useGraphStore } from '@/store/graphStore';
import { scheme } from '@/page/scheme';
import type { CodeLanguage } from './CodeField';

// CodeMirror, and nothing else: this is the one module that imports it, and it
// is only ever reached through `React.lazy` in CodeField. The element registry
// is shared with the deployed page, so an ordinary import here would put a
// code editor into every tool anyone is handed -- the import graph decides
// what ships, and this file is where that graph is cut.

const FONT = {
  '&': { fontSize: '12.5px', borderRadius: '8px', border: `1px solid ${LINE}`, overflow: 'hidden' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '&.cm-focused': { outline: 'none', borderColor: '#6366f1' },
  // A prompt is prose: a line longer than the box wraps, it does not scroll away.
  '.cm-content': { paddingBottom: '8px' },
};

/**
 * One editor instance. Uncontrolled inside -- CodeMirror owns the document --
 * with the two directions handled separately: typing calls `onChange`, and a
 * `value` that changed for any *other* reason (✨ Generate wrote a new body, a
 * file was reloaded from disk) replaces the document. Comparing against the
 * editor's own text is what stops the second from fighting the first.
 */
export default function CodeSurface({ value, onChange, language, placeholder, height, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  height: { min: number; max?: string; fill?: boolean };
  autoFocus?: boolean;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const languageSlot = useRef(new Compartment());
  // One Dark on a dark scheme, CodeMirror's own light look on a light one: a
  // black editor in the middle of a paper-coloured dialog is the one thing in
  // it that ignored the scheme.
  const light = scheme(useGraphStore((state) => state.metadata.gui_scheme)).light === true;

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          languageSlot.current.of(language === 'javascript' ? javascript() : markdown()),
          ...(light ? [] : [oneDark]),
          EditorView.lineWrapping,
          EditorView.theme({
            ...FONT,
            '&': { ...FONT['&'], ...(height.fill ? { height: '100%' } : {}) },
            '.cm-scroller': { ...FONT['.cm-scroller'], minHeight: `${height.min}px`, ...(height.max ? { maxHeight: height.max } : {}) },
          }),
          ...(placeholder ? [placeholderExtension(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => { editor.destroy(); view.current = null; };
    // Built once. Value and language are followed by the effects below; the
    // rest never changes for the life of one field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageSlot.current.reconfigure(language === 'javascript' ? javascript() : markdown()),
    });
  }, [language]);

  return <div ref={host} style={height.fill ? { height: '100%' } : undefined} />;
}

