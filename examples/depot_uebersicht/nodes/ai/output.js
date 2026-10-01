/** @typedef {Object} Output
 * @property {Array<{stichtag: string, bezeichnung: string, isin: string, anlageklasse: string, stueck: number, kurs: number, kurswert: number}>} output Extracted positions from the depot statement.
 */
module.exports = {
  "output": [
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Welt Aktien ETF",
      "isin": "DE000TEST0001",
      "anlageklasse": "Fonds/ETF",
      "stueck": 120,
      "kurs": 98.40,
      "kurswert": 11808.00
    },
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Europa Dividende Fonds",
      "isin": "DE000TEST0002",
      "anlageklasse": "Fonds/ETF",
      "stueck": 300,
      "kurs": 31.25,
      "kurswert": 9375.00
    },
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Bundesanleihe 2,5% 2034",
      "isin": "DE000TEST0003",
      "anlageklasse": "Anleihe",
      "stueck": 50,
      "kurs": 101.10,
      "kurswert": 5055.00
    },
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Muster Technologie AG",
      "isin": "DE000TEST0004",
      "anlageklasse": "Aktie",
      "stueck": 40,
      "kurs": 187.30,
      "kurswert": 7492.00
    },
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Kontoguthaben (Verrechnungskonto)",
      "isin": "",
      "anlageklasse": "Liquidität",
      "stueck": 1,
      "kurs": 2450.00,
      "kurswert": 2450.00
    }
  ]
};
