/** @typedef {Object} Input
 * @property {Array<{stichtag: string, bezeichnung: string, isin: string, anlageklasse: string, stueck: number, kurs: number, kurswert: number}>} input The positions of every statement, one flat list.
 * @property {string} darstellung The visualization mode, one of 'Nach Anlageklasse', 'Nach Wertpapier', or 'Verlauf je Stichtag'.
 */
module.exports = {
  "input": [
    {
      "stichtag": "2026-03-31",
      "bezeichnung": "Welt Aktien ETF",
      "isin": "DE000TEST0001",
      "anlageklasse": "Fonds/ETF",
      "stueck": 120,
      "kurs": 98.4,
      "kurswert": 11808
    },
    {
      "stichtag": "2026-06-30",
      "bezeichnung": "Welt Aktien ETF",
      "isin": "DE000TEST0001",
      "anlageklasse": "Fonds/ETF",
      "stueck": 135.5,
      "kurs": 102.15,
      "kurswert": 13841.33
    },
    {
      "stichtag": "2026-06-30",
      "bezeichnung": "Kontoguthaben (Verrechnungskonto)",
      "isin": "",
      "anlageklasse": "Liquidität",
      "stueck": 1,
      "kurs": 1180.5,
      "kurswert": 1180.5
    }
  ],
  "darstellung": "Nach Anlageklasse"
};
