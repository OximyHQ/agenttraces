---
name: AgentTraces
description: A quiet systems manual for the memory shared by coding agents.
colors:
  paper: "#ffffff"
  ink: "#171717"
  muted-ink: "#666560"
  rule: "#deddd8"
  soft-rule: "#efeee9"
  wash: "#f7f7f4"
  link: "#315f9d"
  live: "#287451"
  warn: "#a35b22"
  diagram-ink: "#3f3e3b"
  chapter: "#cfcec8"
  body-ink: "#454441"
  nav-wash: "#fbfbf9"
  selected-wash: "#ecece8"
typography:
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(2.75rem, 7vw, 5.2rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  section:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(1.6rem, 3.5vw, 2.35rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  lede:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(1rem, 2vw, 1.16rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "4px"
  panel: "2px"
  pill: "999px"
spacing:
  tight: "8px"
  base: "16px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  code-panel:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
---

# Design System: AgentTraces

## Overview

**Creative North Star: "The Running Systems Manual"**

AgentTraces should feel like the clearest internal tool an excellent infrastructure team ever wrote: direct, inspectable, and calm enough to trust with sensitive work. Pages read as living technical documents rather than campaigns or collections of cards. Product diagrams, terminal commands, timelines, and policy tables are the visual material.

**Key Characteristics:** restrained monochrome surfaces, blue textual actions, precise rules, wide breathing room, authored system diagrams, and dense operational views that remain easy to scan.

## Colors

White paper and near-black ink do most of the work. Blue is reserved for navigation and retrieval actions; green and amber communicate real state only.

**The Evidence Color Rule.** Color marks a link, selected state, health, or warning. It never exists merely to make an area feel more designed.

## Typography

**Display Font:** Arial/Helvetica system sans
**Body Font:** Arial/Helvetica system sans
**Code Font:** SFMono-Regular/Menlo system mono

Display typography is compact and factual. Body copy is conversational but exact. Monospace appears only for commands, identifiers, paths, and measured values.

## Layout

Marketing and explanatory pages use a centered 920px reading frame with generous vertical intervals. Operational dashboard views expand to 1280px and use a persistent narrow navigation rail, a list pane, and a detail pane. Responsive layouts collapse in reading order rather than shrinking desktop columns.

## Elevation & Depth

The system is flat by default. Hierarchy comes from whitespace, rules, tonal washes, and sticky spatial relationships. A small offset shadow may appear only for floating copy confirmations or mobile navigation.

## Shapes

Panels are nearly square with 2–4px corners. Pills are limited to compact state and filter controls. Diagrams use one-pixel rules, square nodes, and small circular connection points.

## Components

Buttons are compact, text-led, and explicit. Code panels combine tabs, command text, and one copy action. Dashboard rows use typography and alignment before container chrome. Selected states use an underline or tonal wash. Focus uses a clearly visible two-pixel blue outline.

## Do's and Don'ts

### Do:

- **Do** demonstrate product mechanics with real commands and labeled synthetic trace data.
- **Do** use whitespace to separate chapters and rules to explain relationships.
- **Do** keep every important surface usable with keyboard and touch.

### Don't:

- **Don't** build the page from repeated icon cards.
- **Don't** use gradients, glass, glow, or decorative dashboard charts.
- **Don't** invent customers, prices, benchmarks, production endpoints, or capabilities.
