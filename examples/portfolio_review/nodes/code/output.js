/**
 * @typedef {Object} PositionMetric
 * @property {string} account The account name where the position is held.
 * @property {string} name The name of the security.
 * @property {string} identifier The ISIN or ticker symbol.
 * @property {string} asset_type The asset type.
 * @property {string} theme The theme classification.
 * @property {string} region The geographic region.
 * @property {number} quantity The number of units held.
 * @property {number} cost_eur The total cost basis in EUR.
 * @property {number} value_eur The current market value in EUR.
 * @property {number} pnl_eur The unrealised P&L in EUR.
 * @property {number} pnl_pct The unrealised P&L in percentage.
 * @property {number} weight_pct The position weight in percentage of total portfolio value.
 */

/**
 * @typedef {Object} AllocationItem
 * @property {string} label The category label (theme, asset type, region, or account name).
 * @property {number} value_eur The total value in EUR for this category.
 * @property {number} weight_pct The percentage share of total portfolio value.
 */

/**
 * @typedef {Object} DuplicateItem
 * @property {string} identifier The security identifier held in multiple accounts.
 * @property {string} name The name of the security.
 * @property {string[]} accounts The list of account names holding this identifier.
 */

/**
 * @typedef {Object} SmallPositionItem
 * @property {string} account The account name.
 * @property {string} name The security name.
 * @property {string} identifier The security identifier.
 * @property {number} value_eur The market value in EUR (under 500).
 */

/**
 * @typedef {Object} RiskFlagItem
 * @property {string} account The account name.
 * @property {string} name The security name.
 * @property {string} identifier The security identifier.
 * @property {string} flag The risk flag triggered.
 * @property {number} [value] The relevant metric value.
 */

/**
 * @typedef {Object} ConcentrationMetrics
 * @property {number} hhi Herfindahl-Hirschman Index over the position weights.
 * @property {number} top_10_share_pct The combined share of the top 10 positions in percentage.
 * @property {number} largest_position_share_pct The share of the single largest position in percentage.
 */

/**
 * @typedef {Object} MetricsObject
 * @property {number} total_value_eur Total portfolio value in EUR.
 * @property {number} total_cost_eur Total portfolio cost basis in EUR.
 * @property {number} total_pnl_eur Total unrealised P&L in EUR.
 * @property {number} total_pnl_pct Total unrealised P&L in percentage.
 * @property {number} number_of_positions Total number of positions.
 * @property {number} number_of_accounts Total number of distinct accounts.
 * @property {PositionMetric[]} positions All positions enriched with weight percentage.
 * @property {AllocationItem[]} allocation_by_theme Allocation grouped by theme.
 * @property {AllocationItem[]} allocation_by_asset_type Allocation grouped by asset type.
 * @property {AllocationItem[]} allocation_by_region Allocation grouped by region.
 * @property {AllocationItem[]} allocation_by_account Allocation grouped by account.
 * @property {ConcentrationMetrics} concentration Concentration metrics.
 * @property {DuplicateItem[]} duplicates Securities held across multiple accounts.
 * @property {SmallPositionItem[]} small_positions Positions with value under EUR 500.
 * @property {RiskFlagItem[]} risk_flags Risk flags identified in the portfolio.
 * @property {string[]} notes Data-quality notes.
 */

/**
 * @typedef {Object} ChartPoint
 * @property {string} label The category label.
 * @property {number} value The numerical value.
 */

/**
 * @typedef {Object} ChartObject
 * @property {string} kind The chart type.
 * @property {string} title The chart title.
 * @property {ChartPoint[]} points The data points for the chart.
 */

/**
 * @typedef {Object} Output
 * @property {MetricsObject} metrics Computed quantitative metrics of the portfolio.
 * @property {ChartObject} chart Chart block configuration for allocation by theme.
 */

module.exports = {
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
      },
      {
        "account": "Main depot",
        "name": "All-World Equity ETF (Dist)",
        "identifier": "XX0000000102",
        "asset_type": "ETF",
        "theme": "Broad World Equity",
        "region": "Global",
        "quantity": 140,
        "cost_eur": 13734.00,
        "value_eur": 16996.00,
        "pnl_eur": 3262.00,
        "pnl_pct": 23.75,
        "weight_pct": 28.08
      },
      {
        "account": "Savings plan",
        "name": "Overnight Rate ETF",
        "identifier": "XX0000000120",
        "asset_type": "Money market",
        "theme": "Defensive / Cash",
        "region": "Global",
        "quantity": 95,
        "cost_eur": 13319.00,
        "value_eur": 13499.50,
        "pnl_eur": 180.50,
        "pnl_pct": 1.36,
        "weight_pct": 22.31
      }
    ],
    "allocation_by_theme": [
      {
        "label": "Broad World Equity",
        "value_eur": 47019.50,
        "weight_pct": 77.69
      },
      {
        "label": "Defensive / Cash",
        "value_eur": 13499.50,
        "weight_pct": 22.31
      }
    ],
    "allocation_by_asset_type": [
      {
        "label": "ETF",
        "value_eur": 47019.50,
        "weight_pct": 77.69
      },
      {
        "label": "Money market",
        "value_eur": 13499.50,
        "weight_pct": 22.31
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
      },
      {
        "label": "Savings plan",
        "value_eur": 13499.50,
        "weight_pct": 22.31
      }
    ],
    "concentration": {
      "hhi": 3815.11,
      "top_10_share_pct": 100.00,
      "largest_position_share_pct": 49.61
    },
    "duplicates": [],
    "small_positions": [],
    "risk_flags": [
      {
        "account": "Main depot",
        "name": "World Equity ETF (Acc)",
        "identifier": "XX0000000101",
        "flag": "pnl above +50%",
        "value": 36.03
      }
    ],
    "notes": []
  },
  "chart": {
    "kind": "donut",
    "title": "Allocation by theme",
    "points": [
      {
        "label": "Broad World Equity",
        "value": 47019.50
      },
      {
        "label": "Defensive / Cash",
        "value": 13499.50
      }
    ]
  }
};
