---
name: pdf
description: Extract text and tables from PDFs, merge, split or rotate pages, render pages to images, and create PDFs.
---

# PDF

## Read
- Text with layout: `pdfplumber.open(path)`, then `page.extract_text()` per page.
- Tables: `page.extract_tables()`; check the result, because merged cells and headers often need cleanup in pandas.
- Command line: `pdftotext -layout input.pdf -` prints text quickly.
- Scanned pages have no text layer. On the full image, render them (`pdftoppm -r 200 -png in.pdf /mnt/data/tmp/page`) and run `pytesseract.image_to_string` on each image.

## Change
- Merge, split, reorder or rotate with pypdf: `PdfReader`, `PdfWriter`, `writer.add_page(page)`, `page.rotate(90)`.
- Keep the original: write a new file to `/mnt/data/outputs/`.

## Render
`pdftoppm -r 150 -png -f 1 -l 1 input.pdf /mnt/data/outputs/page` renders page 1 to `page-1.png`. Rendering is the best way to check what a page looks like.

## Create
- Reports with styles, tables and images: reportlab's `SimpleDocTemplate` with `Paragraph`, `Table` and `Image` flowables.
- From a Word or Markdown file on the full image: `soffice --headless --convert-to pdf --outdir /mnt/data/outputs input.docx`.
