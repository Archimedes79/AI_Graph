/**
 * The manuscript as text, read once and handed to every reviewer.
 *
 * @typedef {Object} Inputs
 * @property {string} file  the file's content (read for us: the port is a file path)
 */

/** @param {Inputs} inputs */
function run(inputs) {
  return { text: String(inputs.file ?? '') };
}

