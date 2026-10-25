---
name: word-documents
description: Create, convert and edit Word (.docx) documents with python-docx, and pandoc on the full image.
---

# Word documents

## From Markdown
- On the full image (`pandoc` is on the PATH), write the content as Markdown and convert: `pandoc input.md -o /mnt/data/outputs/<name>.docx`. Pandoc maps headings, lists, tables, links and emphasis to native Word styles; add `--reference-doc=<template>.docx` to reuse an uploaded document's styles.
- Otherwise build the document with python-docx as below. For a Markdown document the user only wants to download, the chat's document panel already exports Word files.

## Edit an existing document
- Open with `docx.Document("/mnt/data/uploads/<name>.docx")` and save to outputs under a new name; uploads are read-only.
- Text is split into runs, so a phrase can span several runs. Replace text within a paragraph by rebuilding its runs, and keep the first run's formatting.
- Tables: `document.tables`, then `table.cell(row, column).text`.
- Keep the user's styles: assign existing style names (`paragraph.style = "Heading 2"`) instead of setting fonts directly.

## Create from scratch
Use python-docx for precise layout: `document.add_heading`, `add_paragraph(style="List Bullet")`, `add_table(rows, cols, style="Table Grid")`, `add_picture(path, width=Inches(6))`, `add_page_break()`.

## Check
Reopen the output and print its paragraphs (`[p.text for p in Document(path).paragraphs]`) to confirm the change before reporting it.
