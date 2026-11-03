---
name: spreadsheets
description: Analyze CSV and Excel files with pandas, and write formatted .xlsx workbooks.
---

# Spreadsheets

## Read
- CSV: `pd.read_csv("/mnt/data/uploads/<name>.csv")`. If parsing fails, retry with `sep=None, engine="python"` or `encoding="latin-1"`.
- Excel: `pd.read_excel(path, sheet_name=None)` returns every sheet as a dict.
- Look before you compute: print `df.shape`, `df.dtypes` and `df.head()`. Convert numbers and dates explicitly with `pd.to_numeric(..., errors="coerce")` and `pd.to_datetime(..., errors="coerce")`.

## Analyze
- Compute every number you report. Never estimate totals or averages by reading rows.
- Print small, labeled result tables (`df.to_string()` or `tabulate`) so the answer can quote them.
- State how many rows were dropped or could not be parsed.

## Write .xlsx
- Simple export: `df.to_excel("/mnt/data/outputs/<name>.xlsx", index=False)`.
- Formatted workbooks: use `pd.ExcelWriter(path, engine="xlsxwriter")` to set number formats, column widths, a frozen header row and autofilter.
- openpyxl writes formulas without their results; cells show values only after Excel recalculates. When the user needs numbers immediately, write computed values (and add the formula alongside if they asked for one).
- To edit an existing workbook and keep its formatting, open it with `openpyxl.load_workbook` and save to outputs under a new name.

## Check
Reopen the saved file and print its sheet names and first rows before telling the user it is ready.
