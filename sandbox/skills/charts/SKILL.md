---
name: charts
description: Make clear charts with matplotlib; plt.show() returns them as images.
---

# Charts

- `plt.show()` saves each open figure as a PNG output (`figure-1.png`, …); you can also call `fig.savefig("/mnt/data/outputs/<name>.png", dpi=150, bbox_inches="tight")` for a descriptive name.
- Use one figure per message point. Give every chart a title, axis labels with units, and a legend when there is more than one series.
- Sort categories by value for bar charts; use a line chart only for ordered data such as time.
- Format large numbers (`matplotlib.ticker.FuncFormatter` or `StrMethodFormatter("{x:,.0f}")`) and rotate long tick labels.
- Keep the data that produced a chart and report its key numbers in the answer; a chart alone is hard to verify.
