/**
 * @param {import('./input.js').Input} inputs
 * @returns {import('./output.js').Output}
 */
function run(inputs) {
  const input = inputs && inputs["input"] ? inputs["input"] : { positions: [], notes: [] };
  const rawPositions = Array.isArray(input.positions) ? input.positions : [];
  const notes = Array.isArray(input.notes) ? input.notes : [];

  const number_of_positions = rawPositions.length;

  if (number_of_positions === 0) {
    return {
      "metrics": {
        "total_value_eur": 0,
        "total_cost_eur": 0,
        "total_pnl_eur": 0,
        "total_pnl_pct": 0,
        "number_of_positions": 0,
        "number_of_accounts": 0,
        "positions": [],
        "allocation_by_theme": [],
        "allocation_by_asset_type": [],
        "allocation_by_region": [],
        "allocation_by_account": [],
        "concentration": {
          "hhi": 0,
          "top_10_share_pct": 0,
          "largest_position_share_pct": 0
        },
        "duplicates": [],
        "small_positions": [],
        "risk_flags": [],
        "notes": notes
      },
      "chart": {
        "kind": "donut",
        "title": "Allocation by theme",
        "points": []
      }
    };
  }

  let total_value_eur = 0;
  let total_cost_eur = 0;

  for (const p of rawPositions) {
    total_value_eur += Number(p.value_eur) || 0;
    total_cost_eur += Number(p.cost_eur) || 0;
  }

  const total_pnl_eur = total_value_eur - total_cost_eur;
  const total_pnl_pct = total_cost_eur !== 0 ? (total_pnl_eur / total_cost_eur) * 100 : 0;

  // Enrich positions with weight_pct
  const positions = rawPositions.map(p => {
    const val = Number(p.value_eur) || 0;
    const weight_pct = total_value_eur !== 0 ? (val / total_value_eur) * 100 : 0;
    return {
      ...p,
      quantity: Number(p.quantity) || 0,
      cost_eur: Number(p.cost_eur) || 0,
      value_eur: val,
      pnl_eur: Number(p.pnl_eur) || 0,
      pnl_pct: Number(p.pnl_pct) || 0,
      weight_pct: Number(weight_pct.toFixed(2))
    };
  });

  const accountsSet = new Set(positions.map(p => p.account));
  const number_of_accounts = accountsSet.size;

  // Allocations helper
  function computeAllocation(keyName) {
    const map = {};
    for (const p of positions) {
      const k = p[keyName] || "Unspecified";
      if (!map[k]) {
        map[k] = 0;
      }
      map[k] += p.value_eur;
    }
    const list = Object.keys(map).map(label => {
      const value_eur = map[label];
      const weight_pct = total_value_eur !== 0 ? (value_eur / total_value_eur) * 100 : 0;
      return {
        label,
        value_eur: Number(value_eur.toFixed(2)),
        weight_pct: Number(weight_pct.toFixed(2))
      };
    });
    list.sort((a, b) => b.value_eur - a.value_eur);
    return list;
  }

  const allocation_by_theme = computeAllocation("theme");
  const allocation_by_asset_type = computeAllocation("asset_type");
  const allocation_by_region = computeAllocation("region");
  const allocation_by_account = computeAllocation("account");

  // Concentration metrics
  // HHI over position weights (in percentage points or fraction? Usually sum of squared percentages or squared fractions. Let's use squared percentages as standard: sum((weight_pct)^2) or sum((val/total)*100)^2 = sum(weight_fraction^2)*10000. Example shows 3815.11 which is sum((weight_pct)^2).)
  let hhi = 0;
  for (const p of positions) {
    const frac = total_value_eur !== 0 ? (p.value_eur / total_value_eur) * 100 : 0;
    hhi += frac * frac;
  }

  const sortedByValueDesc = [...positions].sort((a, b) => b.value_eur - a.value_eur);
  const largest_position_share_pct = sortedByValueDesc.length > 0 ? sortedByValueDesc[0].weight_pct : 0;

  let top10Sum = 0;
  for (let i = 0; i < Math.min(10, sortedByValueDesc.length); i++) {
    top10Sum += sortedByValueDesc[i].value_eur;
  }
  const top_10_share_pct = total_value_eur !== 0 ? Number(((top10Sum / total_value_eur) * 100).toFixed(2)) : 0;

  const concentration = {
    hhi: Number(hhi.toFixed(2)),
    top_10_share_pct,
    largest_position_share_pct
  };

  // Duplicates: identifier held in several accounts
  const identifierMap = {};
  for (const p of positions) {
    const id = p.identifier;
    if (!id) continue;
    if (!identifierMap[id]) {
      identifierMap[id] = { name: p.name, accounts: new Set() };
    }
    identifierMap[id].accounts.add(p.account);
  }

  const duplicates = [];
  for (const id of Object.keys(identifierMap)) {
    const accs = Array.from(identifierMap[id].accounts);
    if (accs.length > 1) {
      duplicates.push({
        identifier: id,
        name: identifierMap[id].name,
        accounts: accs
      });
    }
  }

  // Small positions under EUR 500
  const small_positions = [];
  for (const p of positions) {
    if (p.value_eur < 500) {
      small_positions.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        value_eur: p.value_eur
      });
    }
  }

  // Risk flags: leveraged, short, crypto, single stocks, P&L below -10 %, P&L above +50 %
  const risk_flags = [];
  for (const p of positions) {
    const assetTypeLower = (p.asset_type || "").toLowerCase();
    const themeLower = (p.theme || "").toLowerCase();
    const nameLower = (p.name || "").toLowerCase();

    const isLeveraged = themeLower.includes("leveraged") || themeLower.includes("short") || assetTypeLower.includes("leveraged") || assetTypeLower.includes("short") || nameLower.includes("leveraged") || nameLower.includes("short") || nameLower.includes("2x") || nameLower.includes("3x");
    const isCrypto = assetTypeLower.includes("crypto") || themeLower.includes("crypto");
    const isSingleStock = assetTypeLower.includes("stock") || themeLower.includes("single stocks");

    if (isLeveraged) {
      risk_flags.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        flag: "leveraged / short"
      });
    }
    if (isCrypto) {
      risk_flags.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        flag: "crypto"
      });
    }
    if (isSingleStock) {
      risk_flags.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        flag: "single stocks"
      });
    }

    if (p.pnl_pct < -10) {
      risk_flags.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        flag: "pnl below -10%",
        value: p.pnl_pct
      });
    }

    if (p.pnl_pct > 50) {
      risk_flags.push({
        account: p.account,
        name: p.name,
        identifier: p.identifier,
        flag: "pnl above +50%",
        value: p.pnl_pct
      });
    }
  }

  const metrics = {
    total_value_eur: Number(total_value_eur.toFixed(2)),
    total_cost_eur: Number(total_cost_eur.toFixed(2)),
    total_pnl_eur: Number(total_pnl_eur.toFixed(2)),
    total_pnl_pct: Number(total_pnl_pct.toFixed(2)),
    number_of_positions,
    number_of_accounts,
    positions,
    allocation_by_theme,
    allocation_by_asset_type,
    allocation_by_region,
    allocation_by_account,
    concentration,
    duplicates,
    small_positions,
    risk_flags,
    notes
  };

  const chart = {
    kind: "donut",
    title: "Allocation by theme",
    points: allocation_by_theme.map(item => ({
      label: item.label,
      value: item.value_eur
    }))
  };

  return {
    "metrics": metrics,
    "chart": chart
  };
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
