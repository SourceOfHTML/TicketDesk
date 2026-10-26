# Hand-written CSS with design tokens

The web app keeps one hand-written stylesheet, `apps/web/app/globals.css`, organised around custom properties in `:root`. There is no CSS framework, no component library, no CSS-in-JS runtime and no webfont. The visual contract is [`DESIGN.md`](../../DESIGN.md).

The spec described the walking skeleton's styling as "minimal hand-written CSS … no design system". That described what existed, not a decision to keep it plain forever. The app now has a deliberate visual language — Quiet utility — while the implementation stays one file with no styling runtime.

This ADR exists because the opposite choice is the obvious default. A reader who sees a 600-line stylesheet will reasonably reach for Tailwind, CSS Modules or shadcn/ui, and each would be a change to the shape of the UI rather than a local improvement.

## Considered options

- **Tailwind** — fast to iterate, but adds a build dependency, a config file and utility classes throughout the JSX, and contradicts the spec's explicit no-Tailwind line. Rejected.
- **CSS Modules** — better locality per component, but many more files for a seven-page app and a larger diff for the same visual result. Rejected.
- **A component library (shadcn/ui or similar)** — prebuilt accessible widgets, but brings Radix, a class-merge dependency and a large amount of generated code into a deliberately thin UI that owns almost no behaviour. Rejected.
- **One stylesheet with custom-property tokens** — every colour, type step, space step and radius has a name; components use class hooks; the file is read top to bottom. Chosen.

## Consequences

- One file to read before changing the UI, and one token block that a future dark theme can override without a rewrite.
- The class hooks in the JSX are part of the contract: `components/form-field.tsx`, `ticket-badges.tsx` and the page files carry them, so a new control must use the same names rather than inventing a parallel style.
- System fonts only, and light-only for v1. Both are deliberate; the token block is the only place to start for a theme.
- `apps/web` still has no browser test tier. The gates cannot catch a broken grid, clipped focus ring or contrast regression, so verification is the manual matrix in `DESIGN.md` and the pull request.
- The board that settled the direction lives outside the repo, in OpenDesign. `DESIGN.md` is the source of truth; the board is reference.
