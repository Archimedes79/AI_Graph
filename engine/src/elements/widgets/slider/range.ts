// What a slider's stored settings mean: its range, its step and the number it
// stands at.
//
// Its own tiny module, like `text_io/role.ts`, because the page imports it too:
// the port says the range in words, a run emits the value, and the page draws
// the handle -- and all three must read the settings alike. The page had a
// copy of its own with other defaults, so a slider with no max was drawn
// 0..1 while the run clamped it to 0..100.

export interface SliderRange {
  value: number;
  min: number;
  max: number;
  step: number;
}

/** A stored number, or the default when it is missing or not a number at all. */
function num(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return value !== '' && Number.isFinite(n) ? n : fallback;
}

/**
 * The range a slider moves in, from its stored settings. A max at or below the
 * min becomes one above it, a step that is not positive becomes 1, and the
 * value is kept inside the range, even if it is stale after a person narrowed
 * the range around it.
 */
export function sliderRange(settings: { value?: unknown; min?: unknown; max?: unknown; step?: unknown }): SliderRange {
  const min = num(settings.min, 0);
  const max = num(settings.max, 100) > min ? num(settings.max, 100) : min + 1;
  const step = num(settings.step, 1) > 0 ? num(settings.step, 1) : 1;
  const value = Math.min(max, Math.max(min, num(settings.value, min)));
  return { value, min, max, step };
}
