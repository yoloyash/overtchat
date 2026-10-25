---
name: presentations
description: Create and edit PowerPoint (.pptx) decks with python-pptx.
---

# Presentations

- Create: `Presentation()`; use layout 0 for the title slide and layout 1 for title and content. Keep about six bullet points per slide.
- Edit: open the upload, change text in each `shape.text_frame` while keeping its runs' formatting, and save to `/mnt/data/outputs/` under a new name.
- Images and charts: save the chart as PNG first, then `slide.shapes.add_picture(path, left, top, width=Inches(8))`.
- Tables: `slide.shapes.add_table(rows, cols, left, top, width, height).table`.
- On the full image, check the result by converting it: `soffice --headless --convert-to pdf --outdir /mnt/data/tmp deck.pptx`, then render pages with `pdftoppm`.
