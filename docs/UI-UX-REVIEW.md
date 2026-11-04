# Content Studio UI/UX review — 27 October 2026

## Problem observed in the existing interface

Many labels and controls used 7–11 px text, with further shrinking on mobile. The green-black page, sidebar, cards and controls had little surface separation. Important titles competed with decorative category artwork and repeated slogans. Mobile filters compressed to near-unreadable widths. Charts and status colors were hardcoded for dark mode and did not adapt well to light mode.

## Research basis

- W3C WCAG 2.2 Contrast Minimum: normal text needs at least 4.5:1; larger text at least 3:1. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Nielsen Norman Group, Five Principles of Visual Design: scale, contrast and visual hierarchy guide attention. https://www.nngroup.com/articles/principles-visual-design/
- Nielsen Norman Group, Common Region: grouping through space can reduce visual complexity compared with excessive containers. https://www.nngroup.com/articles/common-region/

These are desk-research findings and implementation checks, not a user study or proof of reduced eye strain. Comfort remains subjective and should be reviewed with the owner.

## Applied decisions

- Neutral off-white canvas, white surfaces, charcoal text and a restrained blue action color. Separate slate dark palette remains available.
- Base body text 16 px; secondary labels generally 13–15 px. Buttons and fields normally at least 44 px high; mobile form inputs 16 px to avoid automatic input zoom.
- Strong page titles and metric hierarchy. More spacing between sections and inside cards.
- Remove decorative idea/publication artwork from the visible layout, so actual titles and content lead.
- Two-column mobile filters; single-column idea cards. Calendar keeps readable cells inside its own scroll area.
- Theme-aware chart labels, tooltips, status badges, warnings and errors.
- Device theme choice persists and is not reset by background data synchronization. Existing saved workspace themes remain respected when no device choice exists.
- Visible focus styling, current-page semantics, and a labeled theme toggle.
- Refresh the PWA shell cache version for the update.

## Measured token contrast

| Pair | Ratio |
| --- | --- |
| Main text on white | 14.24:1 |
| Secondary text on page canvas | 5.48:1 |
| Primary button text | 6.20:1 |
| Dark secondary text on panel | 7.75:1 |
| Warning text on white | 6.05:1 |

These measurements cover selected tokens, not a complete WCAG conformance audit.

## Validation

Seven pages checked at 1440, 768 and 390 px: no document horizontal overflow or JavaScript page errors. Screenshots and edit-dialog checks are in artifacts/ui-refresh. Unit tests: 50 passing. Production build and source lint passed. All six existing browser tests passed against the production build, including capture/edit, scheduling/publishing, mobile navigation, and offline reload. The visual matrix also passed against the production build.

Live production verification: 40 ideas, 11 videos, 17 snapshots returned successfully. Mobile category filter measured 163 px at a 390 px viewport; no document overflow or page errors. No content writes were performed. Temporary deployment test access was revoked.
