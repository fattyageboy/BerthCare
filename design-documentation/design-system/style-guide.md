# BerthCare Design System

**Version:** 1.0.0  
**Last Updated:** October 7, 2025

---

## Design Philosophy

> "Simplicity is the ultimate sophistication. If users need a manual, the design has failed."

BerthCare exists to eliminate friction between caregivers and the people they serve. Every design decision starts with a simple question: **Does this help a caregiver provide better care?**

### Core Principles

**Invisible Technology**  
The best interface is no interface. Technology should fade into the background, letting caregivers focus on what matters—their patients.

**Ruthless Simplicity**  
We say no to 1,000 things. Every button, every feature, every pixel must justify its existence. If it doesn't serve the user's immediate goal, it doesn't belong.

**Designed for Reality**  
Our users wear gloves. They work in dim hallways. Their hands are full. They're interrupted constantly. Design for the real world, not the ideal one.

**Perfection in Details**  
The parts you can't see should be as beautiful as the parts you can. Quality goes all the way through—from the corner radius of a button to the timing of an animation.

---

## Color System

**Philosophy:** Color should guide, not distract. Every color has a purpose.

### Primary Palette

**Ocean Blue** `#0A7AFF`  
Our primary action color. Calm, trustworthy, unmistakably interactive.

- **Use:** Primary buttons, links, active states
- **Contrast:** 4.5:1 on white (WCAG AA)
- **Why this blue:** Tested in bright sunlight and dim hallways. Visible but never aggressive.

**Ocean Blue Dark** `#0051D5`  
Pressed states and emphasis.

- **Use:** Button press, hover on dark backgrounds
- **Contrast:** 7.1:1 on white (WCAG AAA)

**Ocean Blue Subtle** `#E5F2FF`  
Whisper-quiet backgrounds.

- **Use:** Selected states, subtle highlights
- **Never for text:** Decorative only

### Semantic Colors

**Success** `#34C759`  
Visit complete. Task done. Everything's good.

- **Contrast:** 3.2:1 on white (WCAG AA Large)
- **Paired with:** Checkmark icon, "Complete" label

**Warning** `#FF9500`  
Attention needed. Not urgent, but don't ignore.

- **Contrast:** 2.9:1 on white (WCAG AA Large)
- **Paired with:** Clock icon, "Pending" label

**Critical** `#FF3B30`  
Stop. Error. Overdue. Immediate action required.

- **Contrast:** 4.5:1 on white (WCAG AA)
- **Paired with:** Alert icon, clear next steps

**Offline** `#8E8E93`  
System status. No connectivity. Working locally.

- **Contrast:** 4.6:1 on white (WCAG AA)
- **Paired with:** Cloud-off icon, reassuring message

### Neutral Scale

We use a 6-step gray scale. No more, no less.

**Text Primary** `#000000`  
Body text. Headings. Maximum readability.

- **Contrast:** 21:1 on white (WCAG AAA)

**Text Secondary** `#3C3C43` (60% opacity)  
Supporting information. Timestamps. Metadata.

- **Contrast:** 11.2:1 on white (WCAG AAA)

**Text Tertiary** `#3C3C43` (30% opacity)  
Placeholder text. Disabled states.

- **Contrast:** 4.5:1 on white (WCAG AA)

**Separator** `#3C3C43` (12% opacity)  
Dividers. Borders. Subtle structure.

**Background Secondary** `#F2F2F7`  
Card backgrounds. Grouped content.

**Background Primary** `#FFFFFF`  
The canvas. Clean, bright, unobtrusive.

### Color Usage Rules

**Never use color alone to convey information.**  
Pair color with icons, labels, or position. A colorblind caregiver should never be confused.

**Test in context.**  
Colors look different on phones vs tablets, in sunlight vs fluorescent lighting. Test everywhere.

**Respect system preferences.**  
Support Dark Mode. Honor high contrast settings. The user knows what they need.

---

## Typography

**Philosophy:** Type should be invisible. If users notice the font, we've failed.

### Font Family

**System Native**  
We use the device's native font. Always.

```
-apple-system, SF Pro, Roboto, Segoe UI, system-ui, sans-serif
```

**Why:** Loads instantly. Feels familiar. Optimized for each platform. Zero bytes over the network.

### Type Scale

We use 5 sizes. That's it.

**Large Title** — 34pt / 41px line height  
Patient names. Page titles. The most important thing on screen.

**Title** — 28pt / 34px line height  
Section headers. Card titles.

**Body** — 17pt / 22px line height  
Everything else. The workhorse. Optimized for readability at arm's length.

**Subhead** — 15pt / 20px line height  
Supporting information. Timestamps. Metadata.

**Caption** — 13pt / 18px line height  
Labels. Tiny details. Use sparingly.

### Font Weights

**Regular (400)** — Default for all body text  
**Semibold (600)** — Emphasis, buttons, headings  
**Bold (700)** — Rare. Only for critical alerts.

**Never use light weights.** caregivers work in all lighting conditions. Thin fonts disappear.

### Line Length

**Optimal:** 50-75 characters per line  
**Maximum:** 90 characters

Longer lines are harder to read. Shorter lines feel choppy. We aim for the sweet spot.

### Text Hierarchy

**Create hierarchy through size, weight, and space—not color.**

Good hierarchy:

- Large Title (34pt, Semibold)
- 24px space
- Body (17pt, Regular)

Bad hierarchy:

- Body (17pt, Blue)
- Body (17pt, Gray)
- Body (17pt, Light Gray)

### Readability Rules

**Line height:** 1.3-1.5x font size  
**Paragraph spacing:** 1.5x line height  
**Never center-align body text:** Left-aligned text is easier to scan  
**Never justify text:** Creates awkward spacing  
**Never use all caps for body text:** Harder to read, feels like shouting

---

## Spacing & Layout

**Philosophy:** Whitespace is not wasted space. It's breathing room for the mind.

### The 8-Point Grid

Every measurement is a multiple of 8.

**Why 8?**

- Divides evenly by 2 (for half-spacing)
- Scales perfectly across screen densities
- Creates consistent rhythm
- Simplifies decisions

### Spacing Scale

**4px** — Tight. Icon padding. Inline elements.  
**8px** — Cozy. Related items. Form field padding.  
**16px** — Comfortable. Default spacing between elements.  
**24px** — Separated. Distinct sections.  
**32px** — Isolated. Major content blocks.  
**48px** — Dramatic. Page-level separation.

**Use these values. Only these values.**

### Layout Principles

**Content First**  
Start with the content. Let it breathe. Add structure only when needed.

**Progressive Disclosure**  
Show the essential. Hide the optional. Reveal complexity gradually.

**One Primary Action**  
Every screen has one main thing to do. Make it obvious. Make it easy.

### Touch Targets

**Minimum:** 44pt × 44pt (iOS) / 48dp × 48dp (Android)  
**Ideal:** 56pt × 56pt for primary actions

**Why so big?**  
caregivers wear gloves. They're moving. They're tired. Make targets impossible to miss.

**Spacing between targets:** Minimum 8px  
Prevent accidental taps. Frustration kills adoption.

### Screen Margins

**Mobile:** 16px edge margins  
**Tablet:** 24px edge margins  
**Desktop:** 32px edge margins

**Never go edge-to-edge with text.** It's uncomfortable to read.

### Content Width

**Maximum line length:** 600px  
**Optimal reading width:** 400-500px

Wide text is hard to read. Constrain width even on large screens.

---

## Depth & Elevation

**Philosophy:** Use depth sparingly. Flat is fast. Shadows are expensive.

### Shadow Levels

**Level 0 — Flat**  
No shadow. Most UI elements.

**Level 1 — Resting**  
`0 1px 3px rgba(0, 0, 0, 0.1)`  
Cards. Containers. Subtle separation from background.

**Level 2 — Raised**  
`0 2px 8px rgba(0, 0, 0, 0.12)`  
Buttons. Dropdowns. Clearly interactive.

**Level 3 — Floating**  
`0 8px 24px rgba(0, 0, 0, 0.15)`  
Modals. Sheets. Demands attention.

**Never use more than 3 levels on one screen.** Too much depth creates visual chaos.

### Corner Radius

**12px** — Default for cards, buttons, inputs  
**8px** — Smaller elements, tags  
**Continuous curve** — For iOS, use SF Symbols' continuous corner radius

**Why 12px?**  
Soft enough to feel friendly. Sharp enough to feel precise. Scales well across sizes.

### Borders

**Use borders sparingly.**  
Prefer shadows or background color changes to create separation.

**When you must use borders:**

- 1px solid
- `rgba(0, 0, 0, 0.1)` opacity
- Never thicker than 1px

---

## Icons

**Philosophy:** Icons should be obvious. If users need a tooltip, use a label instead.

### Icon System

**iOS:** SF Symbols  
**Android:** Material Symbols  
**Web:** System icons or SF Symbols via font

**Why native icons?**

- Load instantly
- Feel familiar
- Scale perfectly
- Maintained by platform teams

### Icon Sizes

**20pt** — Inline with text  
**24pt** — Standard UI icons (navigation, actions)  
**28pt** — Emphasis icons  
**48pt** — Feature icons, empty states

### Icon Style

**Outlined** — Default  
**Filled** — Active/selected states only

**Never mix styles on the same screen.** Consistency creates clarity.

### Icon + Text

**Always pair icons with labels for primary actions.**

Good: [Icon] "Complete Visit"  
Bad: [Icon only]

**Exception:** Navigation tabs can use icons alone if there are 5 or fewer tabs and the icons are universally understood (Home, Calendar, Messages, Profile).

### Icon Color

**Default:** Text Primary color  
**Interactive:** Ocean Blue  
**Status:** Semantic colors (Success, Warning, Critical)

**Never use decorative colors.** Every color should have meaning.

---

## Motion

**Philosophy:** Animation should feel instant. If users notice it, it's too slow.

### Motion Principles

**Purposeful**  
Every animation must serve a function. Delight is not a function.

**Quick**  
Animations should feel instantaneous. 200ms or less for most interactions.

**Natural**  
Use easing that mimics physics. Nothing linear. Nothing robotic.

**Respectful**  
Honor `prefers-reduced-motion`. Some users get motion sick.

### Duration

**100ms** — Instant feedback (button press, toggle)  
**200ms** — Quick transition (fade, slide)  
**300ms** — Screen transition (modal, sheet)

**Never animate longer than 300ms.** Users are waiting. Respect their time.

### Easing

**Ease Out** — Default for entering elements  
`cubic-bezier(0, 0, 0.2, 1)`  
Starts fast, ends slow. Feels natural.

**Ease In** — For exiting elements  
`cubic-bezier(0.4, 0, 1, 1)`  
Starts slow, ends fast. Gets out of the way.

**Linear** — Never use  
Feels robotic and unnatural.

### Common Animations

**Button Press**  
Scale: 1 → 0.96  
Duration: 100ms  
Easing: Ease Out

**Modal Enter**  
Opacity: 0 → 1  
Transform: translateY(20px) → 0  
Duration: 200ms  
Easing: Ease Out

**Toast Notification**  
Slide in from top  
Duration: 200ms  
Auto-dismiss after 3 seconds  
Easing: Ease Out

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Always test with reduced motion enabled.** The app must work perfectly without animation.

---

## Accessibility

**Philosophy:** Accessibility is not a feature. It's a requirement.

### Non-Negotiables

**Color Contrast**

- Body text: 4.5:1 minimum (WCAG AA)
- Large text (20pt+): 3:1 minimum
- Interactive elements: 3:1 minimum

**Test every color combination.** No exceptions.

**Touch Targets**

- Minimum: 44pt × 44pt
- Ideal: 56pt × 56pt
- Spacing: 8pt minimum between targets

**caregivers wear gloves. Make targets big.**

**Focus Indicators**

- Always visible
- 3px solid Ocean Blue
- 2px offset from element
- Never remove `:focus` styles

**Keyboard users must see where they are. Always.**

### Screen Readers

**Use semantic HTML**  
`<button>` not `<div onclick>`  
`<h1>` not `<div class="title">`

**Provide text alternatives**

- Alt text for images
- Labels for form inputs
- ARIA labels for icon buttons

**Announce dynamic changes**  
Use ARIA live regions for:

- Form validation errors
- Loading states
- Success messages

### Voice Control

**Support voice commands**

- "Tap Complete Visit"
- "Scroll down"
- "Go back"

**Use clear, speakable labels**  
Good: "Complete Visit"  
Bad: "Done" (too ambiguous)

### Testing Checklist

- [ ] Navigate entire app with keyboard only
- [ ] Use app with VoiceOver (iOS) or TalkBack (Android)
- [ ] Test with 200% text size
- [ ] Test with high contrast mode
- [ ] Test with reduced motion enabled
- [ ] Test with one hand while wearing gloves

**If you can't use it with gloves on, redesign it.**

---

## Platform Adaptations

**Philosophy:** Feel native. Look like you belong.

### iOS

**Follow Human Interface Guidelines**  
Use native patterns. Don't reinvent navigation.

**Typography**  
SF Pro Text, SF Pro Display  
Dynamic Type support required

**Navigation**  
Tab bar at bottom (3-5 items)  
Navigation bar at top  
Swipe back gesture

**Haptics**  
Light impact on button press  
Medium impact on success  
Heavy impact on error

**Safe Areas**  
Respect notch, home indicator, rounded corners

### Android

**Follow Material Design**  
Use native patterns. Don't force iOS conventions.

**Typography**  
Roboto, Roboto Condensed  
Scalable text support required

**Navigation**  
Bottom navigation (3-5 items)  
Top app bar  
Back button in top-left

**Elevation**  
Use shadows to indicate hierarchy  
Floating Action Button for primary action

**Adaptive Icons**  
Support all icon shapes (circle, square, rounded square)

### Web

**Progressive Enhancement**  
Works without JavaScript  
Enhances with JavaScript

**Responsive Design**  
Mobile-first approach  
Breakpoints: 768px, 1024px

**Keyboard Navigation**  
Tab order makes sense  
Skip links for screen readers  
Escape closes modals

**Browser Support**  
Chrome, Safari, Firefox, Edge (latest 2 versions)

---

## Implementation

### Design Tokens

```css
:root {
  /* Colors */
  --color-ocean-blue: #0a7aff;
  --color-ocean-blue-dark: #0051d5;
  --color-success: #34c759;
  --color-warning: #ff9500;
  --color-critical: #ff3b30;

  /* Spacing (8pt grid) */
  --space-4: 4px;
  --space-8: 8px;
  --space-16: 16px;
  --space-24: 24px;
  --space-32: 32px;
  --space-48: 48px;

  /* Typography */
  --font-large-title: 34px;
  --font-title: 28px;
  --font-body: 17px;
  --font-subhead: 15px;
  --font-caption: 13px;

  /* Shadows */
  --shadow-resting: 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-raised: 0 2px 8px rgba(0, 0, 0, 0.12);
  --shadow-floating: 0 8px 24px rgba(0, 0, 0, 0.15);

  /* Radius */
  --radius-default: 12px;
  --radius-small: 8px;
}
```

---

## Design Principles in Practice

### Question Everything

**Before adding a feature, ask:**

- Does this help a caregiver provide better care?
- Can we solve this without adding UI?
- What can we remove instead?

### Start with the User Experience

**Work backwards from the goal:**

1. What is the user trying to accomplish?
2. What's the fastest path to that goal?
3. What can we eliminate?
4. Now design the interface.

### Obsess Over Details

**The details matter:**

- Corner radius: 12px, not 10px or 15px
- Animation: 200ms, not 250ms
- Touch target: 56pt, not 48pt
- Line height: 1.4, not 1.5

**Test everything:**

- In bright sunlight
- In dim hallways
- With gloves on
- With one hand
- While walking
- While interrupted

### Say No

**We say no to:**

- Features that serve edge cases
- Customization that creates complexity
- "Nice to have" additions
- Anything that doesn't serve the core mission

**We say yes to:**

- Removing features
- Simplifying workflows
- Eliminating steps
- Making the invisible visible

---

## Living Document

This style guide evolves. As we learn from users, we refine our approach.

**Current focus areas:**

- Offline state communication
- Glove-friendly interactions
- One-handed operation
- Interruption recovery

**Next review:** November 2025

---

**Questions?** Challenge these guidelines. Make them better. Design is never finished.
