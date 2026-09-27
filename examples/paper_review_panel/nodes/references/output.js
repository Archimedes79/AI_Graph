/**
 * @typedef {Object} Output
 * @property {string} output  at most six findings on the references, most serious first, one per line, each starting "- [major]" or
 *   "- [minor]" and naming where in the paper it is -- or "- No findings."
 */
module.exports = {
  "output": "- [minor] Reference [2]: no venue or year is given; complete the entry.\n- [minor] Section 1: \"has grown with the number of plots\" cites [1] for a trend it does not show; cite a source that does."
};
