# Examples for "Draw chart"

## The three largest, largest first

```json input
{ "csv": "examples/data/population.csv", "kind": "Horizontal bars", "top": 3 }
```

```json expect
{
  "rows": [
    { "#": 1, "Country": "India", "Population": "1,450,000,000" },
    { "#": 2, "Country": "China", "Population": "1,419,000,000" },
    { "#": 3, "Country": "United States", "Population": "345,000,000" }
  ]
}
```
