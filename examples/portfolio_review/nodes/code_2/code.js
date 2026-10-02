/**
 * @param {import('./input.js').Input} inputs
 * @returns {import('./output.js').Output}
 */
function run(inputs) {
  const metrics = inputs["metrics"];
  const macro = inputs["macro"];
  const risk = inputs["risk"];
  const quant = inputs["quant"];
  const valuation = inputs["valuation"];
  const optimisation = inputs["optimisation"];
  const tax = inputs["tax"];
  const diversification = inputs["diversification"];
  const psychology = inputs["psychology"];
  const counter = inputs["counter"];
  const summary = inputs["summary"];
  const actions = inputs["actions"];
  const watch_list = inputs["watch_list"];
  const bottom_line = inputs["bottom_line"];

  const today = new Date().toISOString().split("T")[0];

  let report = `# Portfolio Review\n\n`;

  // Executive Summary
  report += `## Executive Summary\n`;
  if (summary && typeof summary === "string" && summary.trim().length > 0) {
    report += summary.trim() + `\n\n`;
  } else {
    report += `Executive summary did not arrive.\n\n`;
  }

  // 1. Portfolio Snapshot
  report += `## 1. Portfolio Snapshot\n\n`;
  if (metrics && typeof metrics === "object" && Object.keys(metrics).length > 0) {
    // Totals table or list
    report += `### Totals\n`;
    const formatNumber = (val, decimals = 2) => {
      if (typeof val !== "number") return val;
      return val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    report += `- **Total Value (EUR):** ${formatNumber(metrics.total_value_eur)}\n`;
    report += `- **Total Cost (EUR):** ${formatNumber(metrics.total_cost_eur)}\n`;
    report += `- **Total P&L (EUR):** ${formatNumber(metrics.total_pnl_eur)}\n`;
    report += `- **Total P&L (%):** ${formatNumber(metrics.total_pnl_pct)}%\n`;
    report += `- **Number of Positions:** ${metrics.number_of_positions}\n`;
    report += `- **Number of Accounts:** ${metrics.number_of_accounts}\n\n`;

    // Allocation by Theme
    report += `### Allocation by Theme\n`;
    if (Array.isArray(metrics.allocation_by_theme) && metrics.allocation_by_theme.length > 0) {
      report += `| Theme | Value (EUR) | Share (%) |\n|---|---|---|\n`;
      for (const item of metrics.allocation_by_theme) {
        report += `| ${item.label} | ${formatNumber(item.value_eur)} | ${formatNumber(item.weight_pct)}% |\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Allocation by Asset Type
    report += `### Allocation by Asset Type\n`;
    if (Array.isArray(metrics.allocation_by_asset_type) && metrics.allocation_by_asset_type.length > 0) {
      report += `| Asset Type | Value (EUR) | Share (%) |\n|---|---|---|\n`;
      for (const item of metrics.allocation_by_asset_type) {
        report += `| ${item.label} | ${formatNumber(item.value_eur)} | ${formatNumber(item.weight_pct)}% |\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Allocation by Region
    report += `### Allocation by Region\n`;
    if (Array.isArray(metrics.allocation_by_region) && metrics.allocation_by_region.length > 0) {
      report += `| Region | Value (EUR) | Share (%) |\n|---|---|---|\n`;
      for (const item of metrics.allocation_by_region) {
        report += `| ${item.label} | ${formatNumber(item.value_eur)} | ${formatNumber(item.weight_pct)}% |\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Allocation by Account
    report += `### Allocation by Account\n`;
    if (Array.isArray(metrics.allocation_by_account) && metrics.allocation_by_account.length > 0) {
      report += `| Account | Value (EUR) | Share (%) |\n|---|---|---|\n`;
      for (const item of metrics.allocation_by_account) {
        report += `| ${item.label} | ${formatNumber(item.value_eur)} | ${formatNumber(item.weight_pct)}% |\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Concentration
    report += `### Concentration\n`;
    if (metrics.concentration) {
      report += `- **HHI:** ${formatNumber(metrics.concentration.hhi)}\n`;
      report += `- **Top 10 Share (%):** ${formatNumber(metrics.concentration.top_10_share_pct)}%\n`;
      report += `- **Largest Position Share (%):** ${formatNumber(metrics.concentration.largest_position_share_pct)}%\n\n`;
    } else {
      report += `None\n\n`;
    }

    // Duplicates
    report += `### Duplicates\n`;
    if (Array.isArray(metrics.duplicates) && metrics.duplicates.length > 0) {
      for (const dup of metrics.duplicates) {
        report += `- **${dup.name}** (${dup.identifier}): held in ${dup.accounts.join(", ")}\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Small Positions
    report += `### Small Positions\n`;
    if (Array.isArray(metrics.small_positions) && metrics.small_positions.length > 0) {
      for (const sp of metrics.small_positions) {
        report += `- **${sp.account}** | ${sp.name} (${sp.identifier}): EUR ${formatNumber(sp.value_eur)}\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Risk Flags
    report += `### Risk Flags\n`;
    if (Array.isArray(metrics.risk_flags) && metrics.risk_flags.length > 0) {
      for (const rf of metrics.risk_flags) {
        const valStr = rf.value !== undefined ? ` (Value: ${formatNumber(rf.value)})` : "";
        report += `- **${rf.account}** | ${rf.name} (${rf.identifier}): ${rf.flag}${valStr}\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }

    // Notes
    report += `### Notes\n`;
    if (Array.isArray(metrics.notes) && metrics.notes.length > 0) {
      for (const note of metrics.notes) {
        report += `- ${note}\n`;
      }
      report += `\n`;
    } else {
      report += `None\n\n`;
    }
  } else {
    report += `Metrics section did not arrive.\n\n`;
  }

  // Sections in order: macro, valuation, risk, optimisation, quant, tax, diversification, psychology, counter
  const sections = [
    { name: "macro", content: macro },
    { name: "valuation", content: valuation },
    { name: "risk", content: risk },
    { name: "optimisation", content: optimisation },
    { name: "quant", content: quant },
    { name: "tax", content: tax },
    { name: "diversification", content: diversification },
    { name: "psychology", content: psychology },
    { name: "counter", content: counter }
  ];

  for (const sec of sections) {
    if (sec.content && typeof sec.content === "string" && sec.content.trim().length > 0) {
      report += sec.content.trim() + `\n\n`;
    } else {
      report += `Section ${sec.name} did not arrive.\n\n`;
    }
  }

  // ## 9. Master Action List
  report += `## 9. Master Action List\n`;
  if (Array.isArray(actions) && actions.length > 0) {
    report += `| Priority | Action | Category | Positions | Product | Financial Impact | Tax Impact | Urgency | Counter-Thesis Verdict | Source |\n`;
    report += `|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const act of actions) {
      const priority = act.priority !== undefined ? act.priority : "";
      const actionText = act.action || "";
      const category = act.category || "";
      const positions = Array.isArray(act.positions) ? act.positions.join(", ") : (act.positions || "");
      const product = act.product || "";
      const financialImpact = act["financial impact"] || "";
      const taxImpact = act["tax impact"] || "";
      const urgency = act.urgency || "";
      const counterThesisVerdict = act["counter-thesis verdict"] || "";
      const source = act.source || "";

      report += `| ${priority} | ${actionText} | ${category} | ${positions} | ${product} | ${financialImpact} | ${taxImpact} | ${urgency} | ${counterThesisVerdict} | ${source} |\n`;
    }
    report += `\n`;
  } else {
    report += `Master action list did not arrive.\n\n`;
  }

  // ## 10. Watch List
  report += `## 10. Watch List\n`;
  if (watch_list && typeof watch_list === "string" && watch_list.trim().length > 0) {
    report += watch_list.trim() + `\n\n`;
  } else {
    report += `Watch list did not arrive.\n\n`;
  }

  // ## The Honest Bottom Line
  report += `## The Honest Bottom Line\n`;
  if (bottom_line && typeof bottom_line === "string" && bottom_line.trim().length > 0) {
    report += bottom_line.trim() + `\n`;
  } else {
    report += `Bottom line did not arrive.\n`;
  }

  return { "report": report };
}

// ── Run on its own ─────────────────────────────────────────────────────────
// "node code.js" runs this node on the example in input.js and prints what
// comes out. In a graph the engine runs this node, and this part is left out.
if (/^code(\.js)?$/.test(process.getBuiltinModule('node:path').basename(process.argv[1] ?? ''))) {
  const input = { exports: null };
  const file = process.getBuiltinModule('node:path').join(process.argv[1], '..', 'input.js');
  process.getBuiltinModule('node:vm').runInNewContext(process.getBuiltinModule('node:fs').readFileSync(file, 'utf8'), { module: input });
  const example = input.exports;
  if (!example || typeof example !== 'object' || Array.isArray(example)) throw new Error('input.js has no example yet -- an object keyed by input, written by ✨ Input.');
  const node = { llm: async () => { throw new Error('node.llm needs the engine: node engine/src/main.ts run-node <project> <node id>'); } };
  Promise.resolve(run(example, node)).then((out) => console.log(JSON.stringify(out, null, 2)));
}
