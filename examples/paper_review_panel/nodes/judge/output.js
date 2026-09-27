/**
 * @typedef {Object} Output
 * @property {string} output  the consolidated advice: "Recommendation: …" with one sentence why, then "Must fix:",
 *   "Should fix:" and "Reviewers disagree on:", each a list of findings saying which reviewers raised them
 */
module.exports = {
  "output": "Recommendation: Major revision — the groups were not assigned at random, and the conclusion goes far beyond the data.\n\nMust fix:\n- Plots were assigned by who volunteered, so the groups may differ in more than the schedule (raised by: scientific, adversarial)\n- The abstract claims proof and a mandate from one season on one site (raised by: adversarial, claims)\n\nShould fix:\n- Table 1 reports n = 6 where one sensor failed, and gives water use without a unit (raised by: figures)\n- Reference [2] is incomplete (raised by: references)\n\nReviewers disagree on:\n- nothing"
};
