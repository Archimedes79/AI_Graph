/**
 * @typedef {Object} Output
 * @property {string} output  at most six findings on the figures and tables, most serious first, one per line, each starting "- [major]" or
 *   "- [minor]" and naming where in the paper it is -- or "- No findings."
 */
module.exports = {
  "output": "- [major] Table 1: n = 6 for the adaptive group, where the text says one sensor failed; report the plots that were measured.\n- [minor] Table 1: water use has no unit; give it in litres per plot."
};
