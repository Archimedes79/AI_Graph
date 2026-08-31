import React from 'react';
import { DIMMER } from '../../../../ui/theme';

/** A spacer has nothing to configure — its height above is the whole point. */
export default function SpacerEditor() {
  return (
    <p className="text-xs" style={{ color: DIMMER }}>
      Leerraum. Die Höhe oben bestimmt, wie viel Luft zwischen den Abschnitten steht.
    </p>
  );
}
