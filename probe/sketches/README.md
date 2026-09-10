# Stage 1 source sketches

Drop the six source images here. **Do not commit private identifying information**
(no faces, names, locations in frame).

## Rules

- **Human-made only.** No AI-created or AI-enhanced source art.
- Drawn by **2–3 ordinary / non-professional drawers**, not designers.
- **~40-second target** per sketch, under a real timer.
- Finger, stylus, or simple drawing tools are all fine.
- **No cleanup** after the timer. No redraw after seeing an AI output. No
  optimizing the drawing for a particular model.
- Deliberately include **visible identity features** (especially S02): unusual
  color, giant ears, long nose, asymmetrical eyes, extra limbs, strange
  proportions, crooked tail.
- **Record the drawer** for each sketch (in `stage1-results.csv`, `sketch_author`).
- Before any generation, the drawer writes down that sketch's **2–5 defining
  features** (`stage1-results.csv`, `identity_features`).

## Capture

- Neutral background, drawing clearly visible, crop unrelated surroundings.
- No beautification, no filters, **no AI preprocessing** during the primary test.
- **One source image per sketch, reused unchanged across all three models.**

## Files (exact names)

| ID | File | Sketch |
| --- | --- | --- |
| S01 | `S01-simple-character.png` | Simple character — crude but recognizable |
| S02 | `S02-weird-character.png` | **Weird character — most important.** Several obvious identity markers |
| S03 | `S03-object-interaction.png` | A cat eating pizza |
| S04 | `S04-full-scene.png` | A cat eating pizza in space |
| S05 | `S05-child-like.png` | Very crude / child-like drawing |
| S06 | `S06-unexpected-interpretation.png` | A cat eating pizza in space — drawn in an unusual way (e.g. pizza is the moon) |

Sketches are **not** included in this repository yet — they are collected by the
human tester during Stage 1 setup.
