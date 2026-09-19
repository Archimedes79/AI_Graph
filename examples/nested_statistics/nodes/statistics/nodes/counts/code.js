function run(inputs) {
  const text = String(inputs.text ?? '');
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const longest = words.reduce((best, word) => (word.replace(/\W/g, '').length > best.length ? word.replace(/\W/g, '') : best), '');
  return { output: { words: words.length, sentences: sentences.length, longest } };
}
