/**
 * One row per file: its name beside its summary.
 *
 * @typedef {Object} Inputs
 * @property {string[]} files      every path in the folder
 * @property {string[]} summaries  one summary per file, in the same order
 */

/** @param {Inputs} inputs */
function run(inputs) {
  const files = [].concat(inputs.files ?? []);
  const summaries = [].concat(inputs.summaries ?? []);
  return {
    rows: files.map(function (path, index) {
      return {
        File: String(path).split(/[\\/]/).pop(),
        Summary: summaries[index] == null ? '(no summary — this file failed)' : String(summaries[index]).trim(),
      };
    }),
  };
}

