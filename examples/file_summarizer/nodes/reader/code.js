/**
 * The chosen file, as text -- and one line saying what it is.
 *
 * @typedef {Object} Inputs
 * @property {string} file  the file's content (read for us: the port is a file path)
 * @property {string} path  the same file's path, for its name
 */

/** @param {Inputs} inputs */
function run(inputs) {
  const text = String(inputs.file ?? '');
  const name = String(inputs.path ?? '').split(/[\\/]/).pop() || 'no file chosen';
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return {
    text,
    info: name + '\n' + words.toLocaleString('en') + ' words · ' + text.length.toLocaleString('en')
      + ' characters · about ' + minutes + ' min to read',
  };
}

