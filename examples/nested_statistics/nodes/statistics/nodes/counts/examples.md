## Two sentences

```json input
{ "text": "The cat sat. The dog followed." }
```

```json expect
{ "output": { "words": 6, "sentences": 2, "longest": "followed" } }
```

## Nothing at all

An empty text is not a failure: it is a text with nothing in it.

```json input
{ "text": "" }
```

```json expect
{ "output": { "words": 0, "sentences": 0, "longest": "" } }
```
