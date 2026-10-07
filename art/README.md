# Art

Pixel art for Mic Drop Arcade's wizard-quest layout. It was generated in AICade Studio on the RTX 3060 and
picked by G Nagarjuna. Every asset is original: no existing characters, logos or game art.
`credits.json` records the exact prompt, seed, model license chain and post-processing for each
file.

| Folder | What | Size |
|---|---|---|
| `sprites/wizard/<set>/` | Three quiz wizards, each in four moods (`ask`, `happy`, `sad`, `cheer`, matching `story.mood`): `sage` (old wizard), `sorceress` (young sorceress), `owl` (owl professor). A story pack picks one with `story.wizard_sprite`. | 128×128, transparent |
| `sprites/heroes/` | Twelve pickable heroes, matching the server's character ids. Boys: `arjun`, `kabir`, `sai`, `rohan`, `aditya`, `imran`. Girls: `diya`, `meera`, `zara`, `ananya`, `priya`, `sana`. | 128×128, transparent |
| `backgrounds/` | Seven scenes, picked with `story.scene`: `library-a`, `library-b`, `forest-temple`, `sky-islands`, `crystal-cave`, `night-bazaar`, `observatory`. Each keeps the left side open for the wizard. | 448×256, 48 colours |
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
