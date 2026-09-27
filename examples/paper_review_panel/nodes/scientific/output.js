/**
 * @typedef {Object} Output
 * @property {string} output  at most six findings on scientific soundness, most serious first, one per line, each starting "- [major]" or
 *   "- [minor]" and naming where in the paper it is -- or "- No findings."
 */
module.exports = {
  "output": "- [major] Section 2: plots were assigned by the site manager according to which gardeners volunteered, so the groups may differ in more than the schedule; assign the plots at random.\n- [minor] Section 2: yield is measured without saying how; state the method."
};
