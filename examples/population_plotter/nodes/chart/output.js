/**
 * @typedef {Object} Point
 * @property {string} label  a name from the first column
 * @property {number} value  its number from the first column that holds numbers all the way down
 *
 * @typedef {Object} Figure
 * @property {"bars"} kind  how the chart block draws it
 * @property {string} title  "<that column> by <the first column>" -- or, with nothing to plot, what to do about it
 * @property {Point[]} points  one per row, largest first; none when there is nothing to plot
 *
 * @typedef {Object} Output
 * @property {Figure} figure  what the chart block on the page shows
 */
module.exports = {
  "figure": {
    "kind": "bars",
    "title": "Population by Country",
    "points": [
      {
        "label": "India",
        "value": 1450
      },
      {
        "label": "China",
        "value": 1419
      },
      {
        "label": "Indonesia",
        "value": 283
      }
    ]
  }
};
