# Art

Pixel art for the wizard-quest layout. It was generated in AICade Studio on the RTX 3060 and
picked by G Nagarjuna. Every asset is original: no existing characters, logos or game art.
`credits.json` records the exact prompt, seed, model license chain and post-processing for each
file.

| Folder | What | Size |
|---|---|---|
| `sprites/wizard/` | The quiz wizard in four moods: `ask`, `happy`, `sad`, `cheer`. These match `story.mood` in `docs/PROTOCOL.md`. | 128×128, transparent |
| `sprites/heroes/` | Pickable heroes. Anime boys `arjun`, `kabir`, `sai`; girls `diya`, `meera`, `zara`. These match the server's character ids. | 128×128, transparent |
| `backgrounds/` | Wizard's library tower at night. `library-a` has the magic circle on the left, where the wizard stands. | 448×256, 48 colours |
| `layout-preview.jpg` | Mock-up of the target screen (not shipped) | — |

**Licenses:**
- Z-Image Turbo (Apache-2.0) generated the images.
- BiRefNet (MIT) cut out the backgrounds.
- Studio pixelated each sprite onto a strict grid and palette.

All of it is clear to publish with the game.

**Rendering:** scale by whole numbers with `image-rendering: pixelated`. For example, the
background ×3 to 1344×768 and the wizard ×4 to 512 px tall. Never use smooth scaling, which
blurs the pixels.

**Target layout:** see `layout-preview.jpg`.
- The background fills the screen.
- The wizard is big on the left, standing on the magic circle.
- Three answer options plus an "other" tile sit on the right.
- A dark dialogue box runs along the bottom, overlapping the wizard's lower half; it shows
  the wizard's line, the `speak_start` caption.
- The client copies these files into `client/public/` (Devesh).
