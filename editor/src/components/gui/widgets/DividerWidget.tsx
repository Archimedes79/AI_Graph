import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { LINE } from '../../../ui/theme';

/**
 * A rule between sections, in either direction.
 *
 * `mode` is the orientation, the same field every other variant in this system
 * uses. A vertical rule separates two things standing side by side; a
 * horizontal one ends a section. Both are one line of CSS apart, so making
 * them two widget kinds would have been two files for a `<select>`.
 */
export default function DividerWidget({ widget }: GuiWidgetRuntimeProps) {
  const vertical = widget.mode === 'vertical';
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div
        style={
          vertical
            ? { width: 1, height: '100%', background: LINE }
            : { height: 1, width: '100%', background: LINE }
        }
      />
    </div>
  );
}
