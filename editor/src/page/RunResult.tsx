import { LINE, SURFACE, TEXT } from '@/ui/theme';

/** One output of the graph as a page shows it: what it is called, and what it handed back. */
export interface ShownOutput {
  name: string;
  label: string;
  value: unknown;
}

/**
 * One output's part of what the graph handed back, as it is read: a list one
 * item a line, text as text, a record each of its values, and anything else
 * as the JSON it is -- String() of an object is "[object Object]", which says
 * nothing about the result it stands for.
 */
export function resultText(produced: unknown): string {
  const values = produced !== null && typeof produced === 'object' && !Array.isArray(produced)
    ? Object.values(produced)
    : [produced];
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== null && value !== undefined)
    .map((value) => (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)))
    .join('\n');
}

/**
 * What a tool without a page hands back: each output under its label -- the
 * graph's outputs by name, as any frontend reads them. A page is what a tool
 * shows; without one, this is. It used to be a window an output node could be
 * set to open, floating over an otherwise empty page.
 */
export default function RunResult({ outputs }: { outputs: ShownOutput[] }) {
  const shown = outputs.filter((output) => output.value !== undefined);
  if (!shown.length) return null;
  return (
    <div className="mt-4 space-y-3" aria-label="The run's result">
      {shown.map((output) => (
        <section key={output.name} className="rounded-lg overflow-hidden" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
          <h3 className="px-4 py-2 text-sm font-semibold" style={{ color: TEXT, borderBottom: `1px solid ${LINE}` }}>{output.label}</h3>
          <pre className="px-4 py-3 text-sm whitespace-pre-wrap overflow-auto" style={{ color: TEXT, maxHeight: '60vh' }}>
            {resultText(output.value)}
          </pre>
        </section>
      ))}
    </div>
  );
}
