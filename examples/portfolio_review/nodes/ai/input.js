/**
 * @typedef {Object} Input
 * @property {string} prompt The text content of the portfolio export file (CSV format with any delimiter, German or English headers/numbers, multiple accounts).
 */
module.exports = {
  "prompt": "Account,Security,Identifier,Asset class,Quantity,Avg cost,Last price,Currency,Market value (EUR)\nMain depot,World Equity ETF (Acc),XX0000000101,ETF,310,71.20,96.85,EUR,30023.50\nMain depot,All-World Equity ETF (Dist),XX0000000102,ETF,140,98.10,121.40,EUR,16996.00\nSavings plan,Overnight Rate ETF,XX0000000120,Money market ETF,95,140.20,142.10,EUR,13499.50"
};
