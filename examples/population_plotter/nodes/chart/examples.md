# Examples for "What to plot"

## The largest first, from the first numeric column

```json input
{ "csv": "examples/data/three_countries.csv" }
```

```json expect
{
  "figure": {
    "kind": "bars",
    "title": "Population by Country",
    "points": [
      { "label": "India", "value": 1450 },
      { "label": "China", "value": 1419 },
      { "label": "Indonesia", "value": 283 }
    ]
  }
}
```

## Nothing chosen yet is still a figure, so the chart says what to do

```json input
{ "csv": "" }
```

```json expect
{ "figure": { "kind": "bars", "title": "Choose a CSV file to plot.", "points": [] } }
```
