/**
 * @typedef {Object} Position
 * @property {string} account The account name where the position is held.
 * @property {string} name The name of the security.
 * @property {string} identifier The ISIN or ticker symbol.
 * @property {string} asset_type The asset type (ETF, ETC, ETN, ETP, stock, bond, fund, money market, crypto).
 * @property {string} theme The theme classification (Broad World Equity, Dividend / Income, Precious Metals, Emerging Markets, Fixed Income, Real Estate, Technology / Innovation, Leveraged / Short / Hedge, Single Stocks, Crypto, Defensive / Cash, Frontier / Niche).
 * @property {string} region The geographic region inferred from the name.
 * @property {number} quantity The number of units held.
 * @property {number} cost_eur The total cost basis in EUR.
 * @property {number} value_eur The current market value in EUR.
 * @property {number} pnl_eur The unrealised P&L in EUR.
 * @property {number} pnl_pct The unrealised P&L in percentage.
 */

/**
 * @typedef {Object} OutputData
 * @property {Position[]} positions The list of cleaned portfolio positions.
 * @property {string[]} notes A list of data-quality notes.
 */

/**
 * @typedef {Object} Output
 * @property {OutputData} output The parsed portfolio data containing positions and notes.
 */

module.exports = {
  "output": {
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
        "pnl_pct": 36.03
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
        "pnl_pct": 23.75
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
        "pnl_pct": 1.36
      }
    ],
    "notes": []
  }
};
