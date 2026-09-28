/**
 * @typedef {Object} Input
 * @property {string} scientific  the scientific reviewer's findings: one per line, each starting "- [major]" or "- [minor]"
 * @property {string} adversarial  the adversarial reviewer's findings, the same way
 * @property {string} claims  the evidence and claims reviewer's findings, the same way
 * @property {string} references  the references reviewer's findings, the same way
 * @property {string} figures  the figures and tables reviewer's findings, the same way
 */
module.exports = {
  "scientific": "- [major] Section 2: plots were assigned by the site manager according to which gardeners volunteered, so the groups may differ in more than the schedule; assign the plots at random.\n- [minor] Section 2: yield is measured without saying how; state the method.",
  "adversarial": "- [major] Section 2: volunteers who water adaptively may simply be more careful gardeners; compare the same plots under both schedules.\n- [major] Abstract: \"should be mandatory for all urban gardens\" goes far beyond 12 plots on one site; say what the study shows.",
  "claims": "- [major] Abstract: \"prove\" and \"mandatory for all urban gardens\" are not supported by one season on one site; soften the claim.\n- [minor] Section 1: the 20% to 30% savings of reference [3] are from greenhouses; say so where they are compared.",
  "references": "- [minor] Reference [2]: no venue or year is given; complete the entry.\n- [minor] Section 1: \"has grown with the number of plots\" cites [1] for a trend it does not show; cite a source that does.",
  "figures": "- [major] Table 1: n = 6 for the adaptive group, where the text says one sensor failed; report the plots that were measured.\n- [minor] Table 1: water use has no unit; give it in litres per plot."
};
