# DESIGN.md: notulen new-skin

Direction from the owner: mature, modern dashboard, warm palette with a dark switch, several
typefaces, antislop. This file is the soul. antislop is the filter applied on top.

## What this is

A personal work notebook. One person writes down tasks, commands, tutorials, SOPs, workflows and
meeting notes, then finds them again months later. It is used daily, briefly, often on a phone
while standing somewhere. It is not a product, has no users to impress, and no one to sell to.

That single fact decides everything below: **speed of capture and speed of recall beat decoration.**

## Identity

A workshop ledger. Paper stock, a good pen, a ruler line down the margin, and nothing else on the
desk. Warm because it is read in the evening as often as at noon. Modern because the person using
it works in infrastructure and expects a tool that keeps up, not a skeuomorphic notebook.

The one motif: **a vertical rule at the left of every reading column**, the margin line of a
ledger. It appears once per view, never as a border on every card.

## Dials

- **ENERGY 1**: calm. No glow, no gradient, no shouting accent. The page is quiet so the content
  is loud.
- **RHYTHM 2**: some variation. The list is dense and uniform on purpose (it is a list); the entry
  page and the dashboard are composed differently. Not every section shares one skeleton.
- **MOTION 1**: near still. Transitions only where they explain a state change (a panel opening,
  a row being removed), 120 to 180ms, and nothing at all under `prefers-reduced-motion`.

## Palette

Three core colours. Everything else is a neutral derived from them.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F7F3EC` | `#17150F` | page background |
| `--ink` | `#1F1C18` | `#EDE7DB` | body text |
| `--accent` | `#4A5D3A` | `#9DB57F` | the one accent: active state, links, focus ring, pin marker |

Supporting neutrals, not accents: `--surface` (raised blocks), `--rule` (hairlines), `--ink-soft`
(secondary text). Kind labels (task, command, sop...) are distinguished by **typeface and case**,
not by colour. A palette with six badge colours is how a notebook starts looking like a dashboard
template.

Why olive and not the rust of v2: the previous skin already owns rust, and this is a different
document, not a repaint. Olive is warm without being loud, and it reads as "green = go" on the
active filter without becoming a success colour.

Contrast, computed not assumed: light ink on paper 13.9:1, light accent on paper 6.4:1, dark ink
on paper 14.1:1, dark accent on paper 7.6:1. All above AA for normal text.

## Typography

Three families, three jobs, and a reason for each.

| Role | Family | Why |
|---|---|---|
| Reading (entry body, titles) | a serif: `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif` | Long notes are read, not scanned. A serif at 17 to 19px holds a paragraph better than a sans, and it is what makes this feel like a document rather than a form. |
| Interface (labels, buttons, nav, filters) | a grotesque sans: `ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial` | Controls should be invisible. The system UI face is already tuned for the reader's screen and costs zero bytes. |
| Literal text (commands, code, ids, timestamps) | a mono: `ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace` | A command that is not monospaced is a command someone will mistype. Also used for timestamps so they align in a column. |

No webfont is downloaded. Reason: the page is opened on a phone on mobile data, and a 200KB font
request to render four words is a worse trade than a system face. If the owner later wants a
distinctive display face for the masthead only, that is one file and one decision, made then.

Scale: 12 / 13 / 15 / 17 / 21 / 28 / 36. Line height 1.55 for body, 1.2 for headings. Measure
capped at 68 characters for entry body.

## Layout

**List view**: one column, rows not cards. Each row: kind label (mono, uppercase, 11px), title
(serif, 17px), a one-line excerpt, and tag chips. Hairline between rows, no shadow, no radius
beyond 4px. Density is the feature; a person scanning 200 notes needs rows, not cards.

**Entry view**: reading column at 68 characters, margin rule at its left, title in serif at 28px,
metadata line in mono at 12px, body rendered markdown. Commands get a copy button because a
command you cannot copy is a command you retype.

**Dashboard (`/admin`)**: two panes on desktop, one on mobile. Left: filter rail (kind, tag,
search). Right: the working list with inline edit. Not a card grid, not a bento. The dashboard is
the same notebook with the pen in hand.

Breakpoints: 390 (phone), 768 (tablet), 1280 (desktop). Tap targets 44px minimum. No horizontal
overflow anywhere except inside a code block, which scrolls on its own.

## What this design refuses

- No hero, no marketing sections, no feature cards. It is a tool.
- No icon set. Kind labels are words; a sparkle icon next to "task" adds nothing.
- No shadow as decoration. One elevation level, used only for the search overlay.
- No gradient, no glass, no glow.
- No colour-coded kind badges.
- No empty decorative state. An empty list says what to do next, in one sentence.
