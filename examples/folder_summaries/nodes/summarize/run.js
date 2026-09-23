// ai-graph template: ai@1
//
// What this node does when it runs. It asks the model once: system.md is the
// standing instruction, message.md the message -- its {{port}} placeholders
// filled from the inputs, and whatever it does not name appended -- and the
// node's settings decide the rest (model, temperature, tools, images, output
// format). The answer goes out on the port "output".
//
// Left as it is, this file is kept up to date for you. Change it and it is
// yours: a loop, a second call, a check of the answer. It runs sandboxed and
// without this machine's keys -- node.llm asks for the call to be made, at
// most 25 times a run.
async function run(inputs, node) {
  const output = await node.llm({
    system: node.texts.system,
    message: node.texts.message,
    inputs,
  });
  return { output };
}
