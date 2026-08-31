import React from 'react';
import type { GuiWidget } from '../../../../types/graph';
import { DIMMER, FIELD_ON_SURFACE, MUTED } from '../../../../ui/theme';

interface Props { widget: GuiWidget; onUpdate: (patch: Partial<GuiWidget>) => void }

/**
 * Prose, and which of the three roles it plays.
 *
 * A heading and a paragraph were two widget kinds for a moment; they hold the
 * same string, contribute the same ports (none) and are typed into the same
 * box. What differs is formatting, so it is a `mode`, the same field
 * `input_picker` and `text_io` already use for their own variants.
 */
const ROLES: { value: string; label: string }[] = [
  { value: 'heading', label: 'Überschrift — groß, Luft darüber' },
  { value: 'body', label: 'Fließtext — normal, oben beginnend' },
  { value: 'caption', label: 'Bildunterschrift — klein und leise' },
];

export default function TextEditor({ widget, onUpdate }: Props) {
  const mode = widget.mode || 'body';
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Rolle</label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={mode}
          onChange={(e) => onUpdate({ mode: e.target.value })}
        >
          {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Text</label>
        <textarea
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ ...FIELD_ON_SURFACE, minHeight: mode === 'heading' ? 40 : 90, resize: 'vertical' }}
          value={typeof widget.value === 'string' ? widget.value : ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={mode === 'heading' ? 'Dies ist eine Überschrift' : 'Hier steht viel Text, **fett**, ein [Link](https://…)'}
        />
        {mode !== 'heading' && (
          <p className="text-xs mt-1" style={{ color: DIMMER }}>
            Markdown: **fett**, *kursiv*, `Code`, [Link](url), - Liste, und Tabellen mit |.
          </p>
        )}
      </div>
    </div>
  );
}
