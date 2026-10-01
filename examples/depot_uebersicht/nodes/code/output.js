/** @typedef {Object} Output
 * @property {Array<{bezeichnung: string, isin: string, anlageklasse: string, stueck: number, kurs: number, kurswert: number, anteil: number}>} tabelle The positions of the latest statement date, sorted by kurswert descending, including percentage share.
 * @property {Object} diagramm A chart object suitable for a chart block depending on the selected visualization mode.
 * @property {string} csv All positions across all statement dates as a CSV text with header.
 */
module.exports = {
  "tabelle": [
    {
      "bezeichnung": "Welt Aktien ETF",
      "isin": "DE000TEST0001",
      "anlageklasse": "Fonds/ETF",
      "stueck": 120,
      "kurs": 98.40,
      "kurswert": 11808.00,
      "anteil": 32.74
    },
    {
      "bezeichnung": "Europa Dividende Fonds",
      "isin": "DE000TEST0002",
      "anlageklasse": "Fonds/ETF",
      "stueck": 300,
      "kurs": 31.25,
      "kurswert": 9375.00,
      "anteil": 26.00
    },
    {
      "bezeichnung": "Muster Technologie AG",
      "isin": "DE000TEST0004",
      "anlageklasse": "Aktie",
      "stueck": 40,
      "kurs": 187.30,
      "kurswert": 7492.00,
      "anteil": 20.77
    },
    {
      "bezeichnung": "Bundesanleihe 2,5% 2034",
      "isin": "DE000TEST0003",
      "anlageklasse": "Anleihe",
      "stueck": 50,
      "kurs": 101.10,
      "kurswert": 5055.00,
      "anteil": 14.01
    },
    {
      "bezeichnung": "Kontoguthaben (Verrechnungskonto)",
      "isin": "",
      "anlageklasse": "Liquidität",
      "stueck": 1,
      "kurs": 2450.00,
      "kurswert": 2450.00,
      "anteil": 6.79
    }
  ],
  "diagramm": {
    "kind": "doughnut",
    "title": "Kurswerte nach Anlageklasse",
    "points": [
      {
        "label": "Fonds/ETF",
        "value": 21183.00
      },
      {
        "label": "Aktie",
        "value": 7492.00
      },
      {
        "label": "Anleihe",
        "value": 5055.00
      },
      {
        "label": "Liquidität",
        "value": 2450.00
      }
    ]
  },
  "csv": "stichtag;bezeichnung;isin;anlageklasse;stueck;kurs;kurswert\n2026-03-31;Welt Aktien ETF;DE000TEST0001;Fonds/ETF;120;98.4;11808\n2026-03-31;Europa Dividende Fonds;DE000TEST0002;Fonds/ETF;300;31.25;9375\n2026-03-31;Bundesanleihe 2,5% 2034;DE000TEST0003;Anleihe;50;101.1;5055\n2026-03-31;Muster Technologie AG;DE000TEST0004;Aktie;40;187.3;7492\n2026-03-31;Kontoguthaben (Verrechnungskonto);;Liquidität;1;2450;2450"
};
