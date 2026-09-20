// Chat
// A chatbot is two nodes: a page with a chat block, and a model. Sending a message starts
// the graph at the AI node; the answer comes back into the conversation, and the
// conversation goes out again as history with the next message.
//
// Written by AI-Graph on every save, from graph.json: read it, do not edit it.
// It is never run -- the engine runs graph.json -- and says the same thing as code:
// one call per node, in the order a whole run takes, each handed what its wires carry.
//
//   gate:      the node runs only in a round that opens its ◆ -- by the event the
//              round began with, or by a true -- and keeps what it made otherwise
//   each:      once per item of the list that arrives, not once for the list
//   readFiles: a file path that arrives is read, and the node is handed its content
//   next(...): handed over once the round is done -- how a page is shown an answer,
//              and what a data node starts the next round with

async function flow(node) {
  // Chat · gui · engine/src/elements/nodes/gui/GuiNodeElement.ts › execute
  // The page this tool shows
  // starts a round: chat_out
  const page = await node.page();

  // Assistant · ai · nodes/assistant/run.js
  // Answer the user's last message as a friendly, concise assistant that remembers the
  // conversation.
  const assistant = await node.assistant({ message: page.chat_out, history: page.chat_history });

  // Once the round is done.
  node.page.next({ chat_in: assistant.output });
}
