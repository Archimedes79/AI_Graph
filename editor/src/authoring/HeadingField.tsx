import { useState } from 'react';
import { TEXT } from '@/ui/theme';

/**
 * A node's heading, which is never empty: a field emptied is not written, and
 * when it loses focus it shows the heading the node still has. What is typed
 * is shown as typed -- a space at the end included -- and written as typed.
 */
export default function HeadingField({ heading, onChange }: { heading: string; onChange: (heading: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      className="text-lg font-bold bg-transparent border-none outline-none w-full"
      style={{ color: TEXT }}
      value={typed ?? heading}
      aria-label="Heading"
      title="The node's heading: never empty -- emptied, it goes back to the one it had"
      onChange={(event) => {
        setTyped(event.target.value);
        if (event.target.value.trim()) onChange(event.target.value);
      }}
      onBlur={() => setTyped(null)}
    />
  );
}
