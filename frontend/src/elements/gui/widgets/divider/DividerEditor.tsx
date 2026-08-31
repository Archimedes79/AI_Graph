import React from 'react';
import { DIMMER } from '../../../../ui/theme';

/** A rule has nothing to configure — its size and tone are set above. */
export default function DividerEditor() {
  return <p className="text-xs" style={{ color: DIMMER }}>Eine Trennlinie. Nichts einzustellen.</p>;
}
