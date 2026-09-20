# Examples for "What to plot"

## The three largest, largest first

```json input
{ "csv": "examples/data/population.csv", "kind": "Horizontal bars", "top": 3 }
```

```json expect
{
  "figure": {
    "kind": "bars",
    "points": [
      { "label": "India", "value": 1450000000 },
      { "label": "China", "value": 1419000000 },
      { "label": "United States", "value": 345000000 }
    ]
  },
  "rows": [
    { "#": 1, "Country": "India", "Population": "1,450,000,000" },
    { "#": 2, "Country": "China", "Population": "1,419,000,000" },
    { "#": 3, "Country": "United States", "Population": "345,000,000" }
  ]
}
```

## A donut gathers everything it does not show into one slice

```json input
{ "csv": "examples/data/population.csv", "kind": "Donut", "top": 3 }
```

```json expect
{
  "figure": {
    "kind": "donut",
    "points": [
      { "label": "India", "value": 1450000000 },
      { "label": "China", "value": 1419000000 },
      { "label": "United States", "value": 345000000 },
      { "label": "All others", "value": 2463000000 }
    ]
  }
}
```
