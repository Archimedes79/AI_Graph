/** @typedef {Object} Input
 * @property {Object} input Raw input data
 * @property {Object} metrics Computed quantitative metrics of the portfolio
 * @property {string} macro Macro and sentiment analysis as Markdown text
 * @property {string} risk The risk report in Markdown format
 * @property {string} quant Quantitative analysis section in Markdown text
 * @property {string} valuation Price and valuation analysis as Markdown text
 * @property {string} optimisation Optimization and long-term income strategy as Markdown text
 * @property {string} tax Tax analysis for a German private investor in Markdown text
 * @property {string} diversification Diversification and security layer analysis in Markdown text
 * @property {string} psychology Behavioural finance analysis as Markdown text
 * @property {string} counter Counter-thesis as Markdown text
 * @property {string} summary Executive summary in Markdown text
 * @property {Array<Object>} actions Master action list
 * @property {string} watch_list Watch list and kill criteria in Markdown text
 * @property {string} bottom_line One honest bottom-line paragraph
 */
module.exports = {
  "input": {},
  "metrics": {
    "total_value_eur": 60519.00,
    "total_cost_eur": 49125.00,
    "total_pnl_eur": 11394.00,
    "total_pnl_pct": 23.20,
    "number_of_positions": 3,
    "number_of_accounts": 2,
    "positions": [
      {
        "account": "Main depot",
        "name": "World Equity ETF (Acc)",
        "identifier": "XX0000000101",
        "asset_type": "ETF",
        "theme": "Broad World Equity",
        "region": "Global",
        "quantity": 310,
        "cost_eur": 22072.00,
        "value_eur": 30023.50,
        "pnl_eur": 7951.50,
        "pnl_pct": 36.03,
        "weight_pct": 49.61
      }
    ],
    "allocation_by_theme": [
      {
        "label": "Broad World Equity",
        "value_eur": 47019.50,
        "weight_pct": 77.69
      }
    ],
    "allocation_by_asset_type": [
      {
        "label": "ETF",
        "value_eur": 47019.50,
        "weight_pct": 77.69
      }
    ],
    "allocation_by_region": [
      {
        "label": "Global",
        "value_eur": 60519.00,
        "weight_pct": 100.00
      }
    ],
    "allocation_by_account": [
      {
        "label": "Main depot",
        "value_eur": 47019.50,
        "weight_pct": 77.69
      }
    ],
    "concentration": {
      "hhi": 3815.11,
      "top_10_share_pct": 100.00,
      "largest_position_share_pct": 49.61
    },
    "duplicates": [],
    "small_positions": [],
    "risk_flags": [],
    "notes": []
  },
  "macro": "## 2. Macro & Sentiment\n\n### Macro Scan\n- **Rates:** Central banks shifting to neutral.",
  "risk": "## 4. Risk Report\n\n### Concentration\n- **HHI:** 1,450",
  "quant": "## 5b. Quantitative Analysis\n\n### Expected Return\n- **Annualized:** 5.5% to 7.0%",
  "valuation": "## 3. Price & Valuation\n\n### Long-Run Valuation Context\n- **Equities:** Global equities trade at elevated multiples.",
  "optimisation": "## 5. Optimisation & Income\n\n### Simplification Target\n- **Current Positions:** 24",
  "tax": "## 6. Tax Intelligence\n\n### Tax Classification\n- **German Equities:** Core MSCI World ETF qualifies for 30% exemption.",
  "diversification": "## 7. Diversification & Security Layer\n\n### Correlation Landscape\nCurrent sleeves show heavy clustering.",
  "psychology": "## 8. Behavioural Finance\n\n### Bias Audit\n- **Fragmentation:** The portfolio contains 34 distinct positions.",
  "counter": "## 8b. Counter-Thesis\n\n### Shared Assumptions Challenged\nConsensus assumes structural growth persists.",
  "summary": "This portfolio review integrates signals across nine specialist analysts.",
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
      "counter-thesis verdict": "First tranche execution recommended",
      "source": "Valuation Analyst"
    }
  ],
  "watch_list": "## Watch List & Kill Criteria\n\n- **Crypto Momentum Sleeve**: Watch for a break below the 200-day moving average.",
  "bottom_line": "The portfolio remains reasonably well-structured for a moderate risk profile."
};
