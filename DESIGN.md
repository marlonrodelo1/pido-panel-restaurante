# Design System Strategy: Operational Noir

### 1. Overview & Creative North Star
**The Creative North Star: "The Culinary Engine"**
This design system rejects the cluttered, bright aesthetic of typical SaaS dashboards in favor of a "Command Center" feel. It is designed for high-pressure restaurant environments where focus is paramount. By utilizing a "Strict Dark Mode" philosophy, we reduce ocular fatigue for staff and owners. 

The system moves beyond a standard grid by utilizing **High-Contrast Editorial Layering**. We achieve a premium feel not through decoration, but through the extreme precision of alignment, intentional negative space (the "Breathing Room" principle), and a palette that uses red not just as a color, but as a surgical tool for urgency and action.

---

### 2. Colors & Tonal Depth
The palette is a study in shadows and precision. We move away from flat UI by treating the screen as a physical workspace with varying heights.

*   **Background (`surface_container_lowest`):** `#0D0D0D` — The base canvas.
*   **Surface (`surface`):** `#1A1A1A` — Primary containers and navigation blocks.
*   **Surface Elevated (`surface_container_high`):** `#242424` — Modals, pop-overs, and active states.
*   **Primary Action (`primary_container`):** `#B91C1C` — Reserved strictly for critical CTAs and "Live" status indicators.

**The "No-Line" Rule:** 
Standard 1px borders are prohibited for sectioning. They create visual noise. Instead, define boundaries through background shifts. A `surface_container_low` card sitting on a `surface` background provides all the separation the eye needs.

**The "Glass & Gradient" Rule:** 
To prevent the UI from feeling "heavy," floating elements (like Toast notifications or mobile action bars) should use a semi-transparent blur: `rgba(26, 26, 26, 0.8)` with a `20px` backdrop-blur. 

**Signature Texture:** 
Apply a subtle linear gradient to Primary Buttons: from `#B91C1C` at the top-left to `#93000b` at the bottom-right. This adds "mass" and tactile quality to the interactive elements.

---

### 3. Typography: The DM Sans Protocol
We use **DM Sans** for its geometric clarity and operational legibility.

*   **Display (Editorial Impact):** `display-lg` (3.5rem) / Medium Weight. Used for high-level daily revenue or total order counts. Letter-spacing: `-0.02em`.
*   **Headlines (Structural Clarity):** `headline-sm` (1.5rem) / Bold. Used for section titles.
*   **Body (Operational Precision):** `body-md` (0.875rem) / Regular. Used for order details and customer notes.
*   **Labels (The Metadata):** `label-sm` (0.6875rem) / Bold / All-Caps. Letter-spacing: `0.05em`. Used for timestamps, status tags, and SKU numbers.

---

### 4. Elevation & Depth: Tonal Layering
In this design system, shadows are almost invisible, and lines are non-existent. Hierarchy is a game of light.

*   **The Layering Principle:** Nested containers must always move "up" in lightness. 
    *   *Example:* Background (`#0D0D0D`) -> Content Section (`#1A1A1A`) -> Active Order Card (`#242424`).
*   **Ambient Shadows:** For floating modals, use an extra-diffused shadow: `0 24px 48px rgba(0, 0, 0, 0.5)`. Never use pure black shadows on a dark background; they must feel like a natural occlusion of light.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., input fields), use the `outline_variant` token at **15% opacity**. This creates a "suggestion" of a container rather than a hard cage.

---

### 5. Components

**Buttons (The Action Primitives)**
*   **Primary:** Solid Dark Red (`#B91C1C`), 8px radius. Text: White, Bold.
*   **Secondary:** Ghost style. No background, `outline_variant` at 20% for the border. 
*   **Tertiary:** Text-only. Primary Red text for destructive actions; White for neutral.

**Operational Cards**
*   **Constraint:** 12px Border Radius.
*   **Rule:** No dividers between card header and body. Use a `16px` padding increase to signify a new content block. 
*   **State:** An "Active" or "New" order should use a 2px left-border accent in Primary Red (`#B91C1C`) rather than a full-color change.

**Input Fields**
*   **Style:** Filled backgrounds (`surface_container_high`) rather than outlined. This makes the "hit area" feel more substantial in a fast-paced kitchen environment.
*   **Active State:** The bottom 2px of the input glows in Primary Red when focused.

**Status Chips**
*   **Selection:** Use high-contrast pairings. An "Incoming" order chip is `#B91C1C` with white text. A "Completed" chip is `surface_container_highest` with grey text.

---

### 6. Do's and Don'ts

**Do:**
*   **Use Asymmetry:** Place high-level stats (Revenue) off-center to create an editorial, high-end feel.
*   **Prioritize Breathing Room:** If an interface feels "crowded," increase the `surface` spacing rather than adding a divider line.
*   **Thin Stroke Icons:** Use 1.5pt stroke icons only. Thick icons look "toy-like" and degrade the professional aesthetic.

**Don't:**
*   **Don't use 100% white text:** Use `on_surface` (`#E5E2E1`) for body text to prevent "halving" (visual vibration) on the dark background.
*   **Don't use shadows to separate cards:** Use color-step shifts (e.g., `#1A1A1A` vs `#242424`).
*   **Don't use bright colors outside the palette:** If you need a "Success" state, use a muted Green or simply use White/Bold to indicate completion. Stay within the 4-color discipline.
