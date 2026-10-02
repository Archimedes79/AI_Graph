/**
 * @typedef {Object} Output
 * @property {string} summary An executive summary in Markdown, 10 to 12 sentences.
 * @property {Array<Object>} actions The master action list, one row per action, ranked.
 * @property {string} watch_list What to watch rather than act on, with kill criteria, as Markdown.
 * @property {string} bottom_line One honest paragraph.
 */
module.exports = {
  "summary": "This portfolio review integrates signals across nine specialist analysts to establish a comprehensive health score of 72 out of 100. The key macro finding indicates persistent inflation risks coupled with high equity valuations, suggesting a defensive posture in developed markets. The biggest risk stems from high thematic concentration in technology equities and leveraged crypto positions. The best optimisation is shifting 5% of excess cash into short-duration inflation-linked bonds. The key tax point highlights potential capital gains realization in Q3 that should be offset by harvesting tax losses. The best diversification idea involves introducing uncorrelated alternative commodities like gold and base metals. The single action for this month is to trim the overweight mega-cap tech allocation to reduce drawdown exposure. Analysts noted a contradiction regarding rate sensitivity between the macro and quant desks, which has been preserved without forced resolution.",
  "actions": [
    {
      "priority": 1,
      "action": "Trim mega-cap tech exposure to target weight",
      "category": "Equities",
      "positions": ["AAPL", "MSFT", "NVDA"],
      "product": "Direct Equities",
      "financial impact": "EUR 25,000 reduction in equity sleeve",
      "tax impact": "Estimated capital gains tax of EUR 1,200",
      "urgency": "High",
      "counter-thesis verdict": "First tranche execution recommended due to stretched valuations",
      "source": "Valuation Analyst"
    },
    {
      "priority": 2,
      "action": "Allocate to short-duration inflation-linked bonds",
      "category": "Fixed Income",
      "positions": ["Global TIPS ETF"],
      "product": "ETF",
      "financial impact": "EUR 15,000 deployment",
      "tax impact": "Neutral",
      "urgency": "Medium",
      "counter-thesis verdict": "Approved as a hedge against sticky inflation prints",
      "source": "Macro Analyst"
    }
  ],
  "watch_list": "## Watch List & Kill Criteria\n\n- **Crypto Momentum Sleeve**: Watch for a break below the 200-day moving average. **Kill Criterion**: Exit entirely if volatility exceeds 80% annualized.\n- **Emerging Market Debt**: Monitor sovereign spread widening. **Kill Criterion**: Sell if spreads exceed 450 bps over US Treasuries.",
  "bottom_line": "The portfolio remains reasonably well-structured for a moderate risk profile, but excessive tech concentration and unhedged rate sensitivity in the fixed income sleeve leave it vulnerable to a 2008-style liquidity shock. Implementing the recommended tranches this month will significantly improve structural resilience without sacrificing long-term expected returns."
};
