---
name: images
description: Edit images with Pillow: crop, resize, rotate, blur or redact regions, annotate, and convert formats.
---

# Images

## Open and inspect
`Image.open("/mnt/data/uploads/<name>")`; print `image.size` and `image.mode` first. Convert with `image.convert("RGB")` before saving as JPEG.

## Common edits
- Crop: `image.crop((left, top, right, bottom))` in pixels from the top-left corner.
- Resize: `image.thumbnail((max_w, max_h))` keeps the aspect ratio.
- Blur a region: crop it, apply `ImageFilter.GaussianBlur(radius)`, then `image.paste(blurred, box)`. Use a radius of at least 2% of the region's width so text and faces become unreadable.
- Redact: `ImageDraw.Draw(image).rectangle(box, fill="black")` fully removes the content, unlike a blur.
- Annotate: `ImageDraw.Draw(image).text((x, y), "label", fill="red")`; draw boxes with `rectangle(box, outline="red", width=4)`.

## Locating a region
Estimate coordinates from the image size and what you can see, then save the result and look at it. If the region is off, adjust the box and run again; small mistakes are common, so always check.

## Save
Save to `/mnt/data/outputs/` under a descriptive name, keeping the original format unless the user asked for another (`image.save(path, quality=90)` for JPEG).
