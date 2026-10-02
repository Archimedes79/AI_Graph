/**
 * @typedef {Object} Output
 * @property {string} summary An executive summary in Markdown, 10 to 12 sentences.
 * @property {Array<Object>} actions The master action list, one row per action, ranked.
 * @property {string} watch_list What to watch rather than act on, with kill criteria, as Markdown -- a list, no heading of its own.
 * @property {string} bottom_line One honest paragraph.
 */
module.exports = {
  "summary": "The portfolio holds <n> positions worth EUR <total>. The macro desk sees <finding>. The largest risk is <risk>. The best optimisation is <idea>. The key tax point is <point>. The best diversification idea is <idea>. This month's one action is <action>. Where the analysts disagree, both views are kept.",
  "actions": [
    {
      "priority": 1,
      "action": "<what to do>",
      "category": "<theme>",
      "positions": ["<position name>"],
      "product": "<product type>",
      "financial impact": "EUR <amount>",
      "tax impact": "<tax effect>",
      "urgency": "<High | Medium | Low>",
      "counter-thesis verdict": "<what the counter-thesis says>",
      "source": "<analyst>"
    }
  ],
  "watch_list": "- **<position or theme>**: <what to watch>. **Kill criterion**: <when to act>.",
  "bottom_line": "<One honest paragraph on the portfolio as it is.>"
};
