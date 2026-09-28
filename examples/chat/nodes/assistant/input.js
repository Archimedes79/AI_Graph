/**
 * @typedef {Object} Input
 * @property {string} history  the conversation so far, one turn per paragraph, each starting "User:" or "Assistant:" -- empty before the first answer
 * @property {string} message  the user's newest message
 */
module.exports = {
  "history": "User: Hi! I am planning a trip to France.\n\nAssistant: How nice! What would you like to know?",
  "message": "What is the capital?"
};
