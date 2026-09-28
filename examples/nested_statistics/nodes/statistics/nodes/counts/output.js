/**
 * @typedef {Object} Counted
 * @property {number} words  how many words
 * @property {number} sentences  how many sentences
 * @property {string} longest  the longest word, without its punctuation
 *
 * @typedef {Object} Output
 * @property {Counted} output  what was counted
 */
module.exports = {
  "output": {
    "words": 6,
    "sentences": 2,
    "longest": "followed"
  }
};
