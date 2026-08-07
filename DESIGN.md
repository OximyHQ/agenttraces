---
name: AgentTraces
description: A small, text-first surface for permissioned coding-agent memory.
colors:
  paper: "#ffffff"
  ink: "#171717"
  muted: "#6f6f6f"
  faint: "#6f6f6f"
  rule: "#dedede"
  soft-rule: "#eeeeec"
  wash: "#f7f7f5"
  link: "#446b9e"
  live: "#397252"
typography:
  family: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
  headingOne: "600 18px/28px"
  headingTwo: "600 16px/24px"
  headingThree: "500 14px/20px"
  body: "400 14px/20px"
  code: "400 13px/21px ui-monospace"
layout:
  frame: "848px"
  readingMeasure: "576px"
  desktopTop: "96px"
  mobileTop: "48px"
  mobileGutter: "24px"
---

# Design System: AgentTraces

## The Quiet Trace Manual

AgentTraces should feel like a precise, useful page an excellent developer
made for other developers. It is small, calm, and immediately legible. The
page explains the product through working commands, short prose, compact
evidence views, and thin rules. It does not behave like a campaign site or an
enterprise dashboard showroom.

The visual system uses a narrow centered frame, small Inter type, subtle code
panels, and generous whitespace. Every page uses original AgentTraces language
and product-specific interface examples.

## Typography

Inter Variable is the only UI typeface. Body copy is 14px with a 20px line
height. The primary heading is intentionally only 18px; section headings are
16px; subsection headings remain at body size with additional weight. Do not
introduce display typography. Monospace is 13px and limited to commands, IDs,
branches, times, and paths.

## Layout

Public pages use an 848px centered frame with a 576px prose measure. Desktop
pages begin 96px from the top. At 620px and below, the frame uses 24px side
gutters and 48px top padding. Sections are separated by 64px of whitespace and
a quiet centered dot marker when a visible chapter break helps.

Operational previews may use up to 720px within the frame. They stay flat and
compact: one outer rule, a small caption, aligned metadata, and event rows.
Real dashboard pages may expand later, but they must keep the same type scale
and information density.

## Color and depth

White and near-black do almost all the work. Muted gray carries secondary
copy. Blue is for links and retrieval context; green is only for a real healthy
or supported state. Panels use a near-white wash and a one-pixel neutral rule.
No gradients, glow, decorative shadows, glass, or ornamental color.
All text tokens, including 9–10px metadata, must retain at least 4.5:1 contrast
against their rendered background.

## Components

- Navigation is plain text with a muted default and underlined hover.
- Setup controls are horizontal text tabs inside one bordered command panel.
- Buttons are text actions unless a later flow genuinely needs a primary
  action.
- Blockquotes represent a developer request or an important product note.
- Tables use row rules and alignment before container chrome.
- Trace previews must be labeled when they use synthetic data.
- Focus is a visible two-pixel blue outline. Tab lists must support arrow keys.

## Provider identity and public links

Use the native provider mark beside a written source name wherever it materially
helps people scan mixed-agent work: trace lists, trace headers, source coverage,
and pull-request trace rows. Provider icons are never the only accessible label,
and unknown or aggregator sources use the neutral terminal-source mark. Keep the
marks small and unframed so they behave like metadata, not decorative badges.

Public trace routes use `/t/<readable-trace-title>/<opaque-token>`. The slug is
for recognition, link previews, and AgentTraces brand context; the opaque token
is the permission capability and remains authoritative.

## Product constraints

- Use the plural product name `AgentTraces` and the lowercase CLI command
  `agenttraces`.
- Never fabricate customers, testimonials, prices, benchmarks, or production
  capabilities.
- Explain that the current subscribed coding agent performs reasoning and that
  AgentTraces retrieves permissioned evidence.
- Personal traces are private by default. Team defaults belong to the owner.
- Prefer a real command or compact trace example over generic feature cards.
