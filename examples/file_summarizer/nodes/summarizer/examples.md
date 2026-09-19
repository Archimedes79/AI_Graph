# Examples for "Summarize"

A model's answer is never the same twice, so it is judged against a sentence
rather than compared with a text. Needs a model: `test --offline` skips it.

## Two sentences when asked for two

```json input
{ "text": "The baker woke at four, as he had for forty years. The oven would not light. He sat on the step, watched the street wake without bread, and for the first time noticed the swifts above the church.", "length": "Two sentences" }
```

```judge
The answer is a summary of about two sentences, in prose rather than bullet points.
```
