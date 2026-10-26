# TicketDesk design

**Quiet utility** — a tool, not a product pitch. Warm paper, ink type, one muted blue
accent, hairline rules, and calm surfaces. The interface should feel like a well-kept desk:
readable at length, dense enough for a queue, never decorative for its own sake.

This file is the visual contract for `apps/web`. It supersedes the spec's line that styling
is "minimal hand-written CSS … no design system" (issue #30): the app now has a deliberate
visual language, while keeping one hand-written stylesheet and no styling runtime. See
[`ADR-0006`](docs/adr/0006-hand-written-css-with-design-tokens.md) for that decision.

## Principles

- **Read the Ticket first.** Type, measure and contrast serve long descriptions, Comment
  threads and Status Change histories.
- **Hairlines, not shadows.** Boundaries are 1px rules and small radii. Cards are surfaces,
  not floating objects.
- **One accent.** Blue marks links, focus and the primary action. Status and Priority own
  their own tint families; the accent does not compete with them.
- **Colour is never the only cue.** Every Status and Priority badge carries its word; the
  pill and the squared tag differ in shape as well as colour.
- **No pretending.** There are no spinners, skeletons or loading overlays. Static chrome
  renders; unknown data waits; an empty result says so.

## Tokens

All colour lives in `:root` in `apps/web/app/globals.css`. Component rules never name a raw
colour.

| Role                | Token                    | Value     | Contrast                                  |
| ------------------- | ------------------------ | --------- | ----------------------------------------- |
| Canvas              | `--color-paper`          | `#FAF9F6` | —                                         |
| Surface             | `--color-surface`        | `#FFFFFF` | —                                         |
| Sunken / table head | `--color-sunken`         | `#F3F1EB` | —                                         |
| Ink                 | `--color-ink`            | `#1C1B18` | 16.36:1 on paper; 17.22:1 on surface      |
| Muted ink           | `--color-ink-muted`      | `#5A574F` | 6.85:1 on paper; 7.21:1 on surface        |
| Subtle ink          | `--color-ink-subtle`     | `#6B675D` | 5.36:1 on paper; 5.64:1 on surface        |
| Hairline            | `--color-line`           | `#D9D4C8` | decorative only                           |
| Control border      | `--color-line-strong`    | `#8F887A` | 3.34:1 on paper; 3.52:1 on surface        |
| Accent              | `--color-accent`         | `#3A5F7D` | 6.41:1 on paper; 6.75:1 on surface        |
| Accent strong       | `--color-accent-strong`  | `#2F5069` | 8.07:1 on paper; 8.49:1 on surface        |
| Accent surface      | `--color-accent-surface` | `#E8EFF7` | accent text 5.82:1                        |
| Focus               | `--color-focus`          | `#2F6FA8` | 5.04:1 on paper; 5.30:1 on surface        |
| On accent           | `--color-on-accent`      | `#FFFFFF` | 6.75:1 on accent; 8.49:1 on accent strong |
| Danger              | `--color-danger`         | `#8A2B26` | 8.13:1 on paper; 8.56:1 on surface        |
| Danger border       | `--color-danger-border`  | `#B3261E` | 6.21:1 on paper                           |
| Danger surface      | `--color-danger-surface` | `#FBEDEC` | danger text 7.51:1                        |
| Staff surface       | `--color-staff-surface`  | `#FAF6EE` | decorative                                |
| Staff rule          | `--color-staff-rule`     | `#B8893B` | decorative                                |

Status badges (text on tint): Open `#1E4F82` on `#E8EFF7`; In progress `#7A4A0B` on
`#F7EEDF`; Resolved `#24603A` on `#E6F1E9`; Closed `#4B4741` on `#EEEBE4`. All are above
6.4:1.

Priority badges (text on tint): Low `#1F5B57` on `#E4F0EE`; Medium `#6B4A0A` on `#F6EDDD`;
High `#8A2B26` on `#F6E7E4`. All are above 6.6:1.

Type: system sans only —
`system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. Scale
13 / 14 / 16 / 18 / 22 / 28 / 32px. Body line-height 1.55; headings 1.25. Page h1 28px;
Ticket title 32px (26px narrow); section h2 22px; micro-labels 13px uppercase at 600 with
0.06em tracking.

Space: 4px base, from `--space-1` (4px) to `--space-8` (64px).

Shape: control and surface radius 6px; pills 999px; no shadows.

Layout: 60rem page container; 70ch reading measure; 26rem auth card; 18rem Staff rail;
40px controls; 32px minimum target for chips and nav links.

Focus: `2px solid var(--color-focus)` with a 2px offset. Use `outline`, not `box-shadow`,
so forced-colors mode keeps it.

## Components

- **Header**: 60rem container, hairline bottom, wordmark left with a small accent square;
  session nav right with a muted email and an accent Sign out. Wraps on narrow screens.
- **Page header**: h1 and the one primary action on one row; the action wraps below the h1
  when there is no room.
- **Buttons**: 40px tall, 6px radius, 600 weight. `.button-primary` is the blue accent fill;
  `.button-quiet` is white with the strong border; `.button-small` is the Copy details
  control. Disabled uses the sunken surface and subtle ink, never whole-form opacity.
- **Fields**: `.field` wrapper, 14px/600 label above a 40px control with the strong border
  and 6px radius. Invalid controls use the danger border. Focus uses the focus ring.
  Disabled controls use the sunken surface. The Raise form caps at 42rem; the Comment
  composer at 70ch; the auth card and Staff panel fill their container.
- **Filters**: a white toolbar with three fieldsets. Legends are uppercase micro-labels.
  Options are 32px chips made from the native checkbox plus an `.option-label` span; the
  checked text goes accent-strong at 600. The checkbox stays native and visible.
- **Radio controls (Status and Priority)**: the badge is the control. There is no outer
  chip. The native radio stays visible for selection and keyboard use; the badge carries a
  1px control border, and selection thickens it to the badge's own ink with an inset ring.
  Invalid groups turn the badge border danger. This keeps one boundary instead of a pill
  inside a box.
- **Badges**: Status is a pill with a leading dot and its tint. Priority is a smaller squared
  tag with a leading square marker, an uppercase label, and its tint. The word is always
  present.
- **Table**: inside `.table-scroll`, which scrolls sideways only when needed. Tinted header
  row of micro-labels, hairline row separators, subtle row hover. The title link is ink at
  500 and underlines on hover or focus. The empty row is italic and muted with generous
  padding.
- **Ticket**: white article, 6px radius, 1.5rem padding. A four-fact grid (Status, Priority,
  Requester, Assignee) sits below a hairline; in the Staff rail layout it becomes 2-up so
  email addresses do not break mid-word.
- **Staff panel**: warm tinted surface with a 3px ochre left rule. Uppercase "Staff" heading.
  Priority, Assignee and the status form are a stack; at 40–64rem the first two share a row
  and the status form spans. In the 18rem rail they are one column. The Update status button
  fills the panel.
- **Comments**: white bordered cards with an author/time header and a 70ch body that
  preserves line breaks. The composer is its own card below the thread. A closed Ticket
  shows no composer.
- **Status changes**: a timeline with a left rule and dot markers. The transition is 14px/600;
  an optional reason is muted; the byline is subtle 13px.
- **Auth**: login, signup and logout share a 26rem card centred on the paper. The primary
  button fills the card.
- **Empty and not-found**: the table's empty row is `.table-empty`; other empty text is
  `.empty`. The 404 is a centred `.empty-state`, not a card.
- **Errors**: the banner is danger-tinted with a 3px danger left rule; field errors are a
  small danger list under the control. `p[role="status"]` notices use the accent surface.
- **Time**: dates use tabular numerals.

## Responsive behaviour

Mobile-first. At 40rem the Staff panel controls may use two columns. At 64rem Staff get the
content column plus the 18rem rail; Requesters keep one column. The Staff layout is one
column at every smaller width, in DOM order: Ticket, Staff panel, Comments, Status changes.
The panel is never sticky. Below 48rem the Ticket title drops to 26px and the auth card and
header tighten. Below 30rem the page action fills the row. The only horizontal scroll is
inside `.table-scroll`.

## States

- First load shows the static chrome and waits; no skeleton, spinner or dimming.
- A refetch keeps the current data visible and unmarked.
- Empty results say **No tickets yet.**, **No tickets match.**, **No comments yet.** or
  **No status changes yet.**
- Errors are field-scoped beside the control or page-level in one alert banner. A 5xx says
  **Something went wrong.** and offers **Copy details**. A 401 ends the session; a 403 stays
  in place. Typed input survives a rejected submission.
- `aria-busy` marks a frozen region; controls are disabled with the tokens above.

## Accessibility

- Normal text meets WCAG AA; every token pair above is recorded with its ratio.
- Focus is always visible: a 2px focus ring with a 2px offset on every interactive element.
  No global `outline: none`.
- Status and Priority are distinguished by word, shape and placement, not colour alone.
- Native checkboxes and radios stay visible with `accent-color`; the chip is the label, not
  a replacement control.
- Control boundaries use `--color-line-strong` at 3.34:1, not the decorative hairline.
- Targets are 40px for buttons and at least 32px for chips, radio options and nav links.
- `prefers-reduced-motion` removes the 120ms colour transitions.
- `forced-colors: active` keeps badge, button, focus and timeline boundaries visible.
- The app does not use native constraint validation (`noValidate`, no `required`,
  `type="email"` or `minLength`); only `[aria-invalid="true"]` is styled.

## What not to add

No CSS framework, component library, CSS-in-JS runtime, webfont, icon library, gradients,
glassmorphism, decorative illustration, emoji, drop shadow, dark theme (v1), sticky Staff
panel, loading skeleton, spinner or client-side validation hint. These are deliberate
absences, not omissions; see ADR-0006.
