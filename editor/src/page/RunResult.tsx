import type { ExecutionResult } from '@/graph';
import { LINE, SURFACE, TEXT } from '@/ui/theme';

/**
 * One output node's part of the run's result, as it is read: each value it
 * was handed, a list one item a line, text as text and anything else as the
 * JSON it is -- String() of an object is "[object Object]", which says nothing
 * about the result it stands for.
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
 * What a run of a tool without a page hands back: each output node's values,
 * under the node's name -- the run's result, as the command line prints it.
 * A page is what a tool shows; without one, this is. It used to be a window
 * an output node could be set to open, floating over an otherwise empty page.
 */
export default function RunResult({ result }: { result: ExecutionResult | null }) {
  const outputs = Object.entries(result?.outputs ?? {});
  if (!outputs.length) return null;
  return (
    <div className="mt-4 space-y-3" aria-label="The run's result">
      {outputs.map(([name, produced]) => (
        <section key={name} className="rounded-lg overflow-hidden" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
          <h3 className="px-4 py-2 text-sm font-semibold" style={{ color: TEXT, borderBottom: `1px solid ${LINE}` }}>{name}</h3>
          <pre className="px-4 py-3 text-sm whitespace-pre-wrap overflow-auto" style={{ color: TEXT, maxHeight: '60vh' }}>
            {resultText(produced)}
          </pre>
        </section>
      ))}
    </div>
  );
}
