# Examples for "Table rows"

## Each file's name beside its summary

```json input
{ "files": ["stories/a.txt", "stories/b.txt"], "summaries": ["The first.", "The second."] }
```

```json expect
{ "rows": [{ "File": "a.txt", "Summary": "The first." }, { "File": "b.txt", "Summary": "The second." }] }
```

## A file whose summary failed says so

```json input
{ "files": ["stories/a.txt"], "summaries": [] }
```

```json expect
{ "rows": [{ "File": "a.txt", "Summary": "(no summary — this file failed)" }] }
```
