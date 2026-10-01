/**
 * @param {import('./input.js').Input} inputs
 * @returns {import('./output.js').Output}
 */
function run(inputs) {
  const inputList = inputs["input"] || [];
  const darstellung = inputs["darstellung"] || "Nach Anlageklasse";

  // Flatten or use direct array of positions
  const allPositions = [];
  if (Array.isArray(inputList)) {
    for (const item of inputList) {
      if (Array.isArray(item)) {
        for (const pos of item) {
          if (pos && typeof pos === "object") {
            allPositions.push(pos);
          }
        }
      } else if (item && typeof item === "object") {
        allPositions.push(item);
      }
    }
  }

  // Find latest stichtag
  let latestStichtag = null;
  for (const pos of allPositions) {
    if (pos.stichtag) {
      if (!latestStichtag || pos.stichtag > latestStichtag) {
        latestStichtag = pos.stichtag;
      }
    }
  }

  // Filter positions for the latest stichtag
  const latestPositions = allPositions.filter(p => p.stichtag === latestStichtag);

  // Calculate total kurswert for latest stichtag
  let totalKurswert = 0;
  for (const pos of latestPositions) {
    totalKurswert += Number(pos.kurswert) || 0;
  }

  // Build tabelle: sort descending by kurswert, add anteil (%)
  const mappedTabelle = latestPositions.map(pos => {
    const kurswert = Number(pos.kurswert) || 0;
    const anteil = totalKurswert > 0 ? Number(((kurswert / totalKurswert) * 100).toFixed(2)) : 0;
    return {
      bezeichnung: pos.bezeichnung || "",
      isin: pos.isin || "",
      anlageklasse: pos.anlageklasse || "",
      stueck: Number(pos.stueck) || 0,
      kurs: Number(pos.kurs) || 0,
      kurswert: kurswert,
      anteil: anteil
    };
  });

  mappedTabelle.sort((a, b) => b.kurswert - a.kurswert);

  // Build diagramm based on darstellung
  let diagramm = {
    kind: "doughnut",
    title: "Kurswerte nach Anlageklasse",
    points: []
  };

  if (darstellung === "Nach Wertpapier") {
    const points = latestPositions.map(p => ({
      label: p.bezeichnung || "",
      value: Number(p.kurswert) || 0
    })).sort((a, b) => b.value - a.value);

    diagramm = {
      kind: "bar",
      title: "Kurswerte nach Wertpapier",
      points: points
    };
  } else if (darstellung === "Verlauf je Stichtag") {
    const stichtagMap = {};
    for (const pos of allPositions) {
      if (pos.stichtag) {
        if (!stichtagMap[pos.stichtag]) {
          stichtagMap[pos.stichtag] = 0;
        }
        stichtagMap[pos.stichtag] += Number(pos.kurswert) || 0;
      }
    }

    const sortedDates = Object.keys(stichtagMap).sort();
    const points = sortedDates.map(date => ({
      label: date,
      value: stichtagMap[date]
    }));

    diagramm = {
      kind: "line",
      title: "Verlauf des Gesamtwerts je Stichtag",
      points: points
    };
  } else {
    const akMap = {};
    for (const pos of latestPositions) {
      const ak = pos.anlageklasse || "Sonstige";
      if (!akMap[ak]) {
        akMap[ak] = 0;
      }
      akMap[ak] += Number(pos.kurswert) || 0;
    }

    const points = Object.keys(akMap).map(ak => ({
      label: ak,
      value: akMap[ak]
    })).sort((a, b) => b.value - a.value);

    diagramm = {
      kind: "doughnut",
      title: "Kurswerte nach Anlageklasse",
      points: points
    };
  }

  // Build csv
  const csvRows = ["stichtag;bezeichnung;isin;anlageklasse;stueck;kurs;kurswert"];
  for (const pos of allPositions) {
    const row = [
      pos.stichtag || "",
      pos.bezeichnung || "",
      pos.isin || "",
      pos.anlageklasse || "",
      pos.stueck ?? "",
      pos.kurs ?? "",
      pos.kurswert ?? ""
    ];
    csvRows.push(row.join(";"));
  }
  const csv = csvRows.join("\n");

  return {
    "tabelle": mappedTabelle,
    "diagramm": diagramm,
    "csv": csv
  };
}

module.exports = { run };

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
