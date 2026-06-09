---
name: FlickHQ
description: Immersive, cinema-grade entertainment curation hub
colors:
  primary: "#E50914"
  secondary: "#eaa71c"
  neutral-bg: "#000000"
  neutral-panel: "#0b0b0b"
  text-main: "#ffffff"
  text-secondary: "#94a3b8"
  text-muted: "#7d8185"
rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-main}"
    rounded: "{rounded.sm}"
    padding: "14px 28px"
  button-primary-hover:
    backgroundColor: "#b80710"
  button-secondary:
    backgroundColor: "#1a1a1a"
    textColor: "{colors.text-main}"
    rounded: "{rounded.sm}"
    padding: "14px 28px"
  button-secondary-hover:
    backgroundColor: "#222222"
  card-media:
    backgroundColor: "{colors.neutral-panel}"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: FlickHQ

## 1. Overview

**Creative North Star: "The Midnight Cinema Canopy"**

FlickHQ is designed to mimic the premium, dim-light atmosphere of a modern high-end cinema. Built strictly on dark, light-absorbing obsidian foundations and highlighted by hot, high-energy crimson spotlights, the visual experience prioritizes high-fidelity poster art and immersive media banners. Every element acts as a projection screen, rising dynamically on interaction and fading into the quiet background at rest.

The interface explicitly rejects sterile SaaS templates, corporate grid outlines, and distracting neon gradients. Visual hierarchy is achieved through structural size contrasts, cinematic scale shifts, and smooth, ease-out-expo transitions.

**Key Characteristics:**
*   **Deep Contrast Framing**: Pure obsidian black backdrops that direct all eyes to colorful movie assets.
*   **Tactile Responsive Focus**: Springs, deep scales, and elegant fades that elevate elements on mouse hover.
*   **Absolute Dark Comfort**: Deep dark tones designed to protect eyes during nighttime viewing.
*   **Bilingual Structural Balance**: Native typography sizing that functions symmetrically for English and Arabic layouts.

## 2. Colors

A strictly committed dark palette where pure movie-theatre black absorbs ambient light, while glowing crimson spotlight anchors visual attention.

### Primary
*   **Cinematic Crimson** (#E50914): The vibrant signature brand color. Reserved strictly for active indicators, primary call-to-actions, scrollbar thumbs, and highly emphasized tags.

### Secondary
*   **Marquee Gold** (#eaa71c): An elegant, cinematic secondary accent. Used exclusively for movie ratings, premium tier highlights, and special catalog classifications.

### Neutral
*   **Midnight Obsidian** (#000000): The core canvas background color. Maximizes screen depth and ensures media poster colors pop off the screen.
*   **Shadow Velvet** (#0b0b0b): The panel container and card base background. Used to create structural layering and distinct separation without hard lines.
*   **Slate Silver** (#94a3b8): Used for subheadings, captions, metadata details, and secondary icons.
*   **Muted Gray** (#7d8185): Used for structural borders, inactive nav links, and low-priority labels.

### Named Rules
**The Spotlighting Rule.** The Cinematic Crimson accent must occupy less than 10% of any single viewport page. It is a dramatic spotlight; overuse dilutes its premium theatrical impact.

## 3. Typography

**Display Font:** Outfit (fallback ui-sans-serif, system-ui, sans-serif)
**Body Font:** Outfit (fallback ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace

The typographic voice is premium and modern. Utilizing bold Outfit headlines paired with light body weights creates an elegant contrast similar to movie poster titles.

### Hierarchy
*   **Display** (font-weight: 800, font-size: clamp(2.5rem, 6vw, 4rem), line-height: 1.1): Used for large home page hero titles and key trailer page highlights.
*   **Headline** (font-weight: 700, font-size: 1.875rem, line-height: 1.2): Used for main section headers (e.g., "Trending Movies", "Select Your Plan").
*   **Title** (font-weight: 600, font-size: 1.25rem, line-height: 1.3): Used for movie card names, plan option titles, and popup headings.
*   **Body** (font-weight: 300, font-size: 1rem, line-height: 1.6): Used for movie synopsis descriptions, reviews, and plan text. Line length is strictly capped at 65-75ch.
*   **Label** (font-weight: 500, font-size: 0.875rem, line-height: 1.4): Used for categories, badges, movie metadata (year, runtime), and small action items.

### Named Rules
**The Cinematic Contrast Rule.** Headlines must always use a minimum font weight of 700 to present a bold, theatrical silhouette, whereas body paragraphs must use a light font weight of 300 to maximize readability on bright dark screens.

## 4. Elevation

The system operates on a "Layered & Luminous" depth model. Depth is established through subtle background shifts (Shadow Velvet panels layered over Midnight Obsidian canvas) combined with high-contrast, razor-thin borders, and smooth, responsive hover scales.

### Shadow Vocabulary
*   **Crimson Halo** (`box-shadow: 0 0 30px rgba(229, 9, 20, 0.15)`): Used on active cards and highlighted elements to mimic back-lit neon signs.
*   **Midnight Ambient** (`box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5)`): Soft, deep shadow to float dropdown menus and auth panels over standard layouts.

### Named Rules
**The Flat-at-Rest Rule.** All cards and list items remain completely flat against their background when passive. Ambient shadows and scale expansions appear only on user focus or hover to signify clickability.

## 5. Components

### Buttons
*   **Shape:** Softly curved corners (4px radius).
*   **Primary:** Cinematic Crimson background with white text. High contrast, highly visible. Padding is strictly `14px 28px`.
*   **Hover / Focus:** Transition to `#b80710` over 200ms using `cubic-bezier(0.16, 1, 0.3, 1)`. On active click, scales slightly to `0.98`.
*   **Secondary:** Muted dark `#1a1a1a` background with white text. Curves match the primary buttons.
*   **Hover / Focus Secondary:** Background transitions to `#222222` with a subtle white/10 border.

### Cards / Containers
*   **Corner Style:** Rounded corners (8px radius).
*   **Background:** Shadow Velvet (`#0b0b0b`) base with a thin border (`1px solid rgba(255, 255, 255, 0.05)`).
*   **Shadow Strategy:** Zero shadow at rest. On hover, scales up to `1.03` with a soft `Crimson Halo` box shadow.
*   **Internal Padding:** Responsive spacing (`16px` on mobile scaling to `24px` on desktop).

### Inputs / Fields
*   **Style:** Dark charcoal background (`#141414`), white text, 4px border-radius, thin border (`1px solid rgba(255, 255, 255, 0.08)`).
*   **Focus:** Border shifts to white/20, accompanied by a subtle red ring glow.

### Navigation
*   **Style:** Translucent header (`rgba(20, 20, 20, 0.4)`) with back-filter blur (`10px`).
*   **Active States:** Links transition from `text-white/70` to `text-white` on hover with a miniature Crimson circle dot indicating active page tabs.

## 6. Do's and Don'ts

### Do:
*   **Do** respect the Spotlighting Rule. Ensure the primary Crimson accent remains a rare, high-value focal point.
*   **Do** cap text body widths to 75 characters to avoid tiring horizontal line-sweeps in movie descriptions.
*   **Do** use smooth custom bezier transitions (`cubic-bezier(0.16, 1, 0.3, 1)`) for all image scale-ups on hover.
*   **Do** ensure high-contrast accessibility (AAA) by verifying readability of light text against obsidian dark backdrops.

### Don't:
*   **Don't** use side-stripe borders (border-left or border-right accent lines greater than 1px) to emphasize cards or notifications.
*   **Don't** use neon gradients or multi-colored text clips that mimic low-end SaaS advertising styles.
*   **Don't** offer a stark white light-mode that ruins the eye comfort of a movie-going experience.
*   **Don't** create flat, static movie poster grids that lack hover transitions and scaling feedback.
*   **Don't** break layouts or use un-optimized font weights when switching layouts from LTR (English) to RTL (Arabic).
