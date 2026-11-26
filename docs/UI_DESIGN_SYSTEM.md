# UI design system

## Product expression

Build a compact desktop workbench with neutral graphite surfaces, restrained blue actions, outline icons, crisp borders, and comfortable data density. Use an original wordmark and application mark. Favor consistent alignment, single-surface panels, direct actions, and plain labels. Use a native window frame in Phase 01 to preserve platform window controls, resizing, and accessibility.

## Starting tokens

Use system UI fonts with Segoe UI first on Windows and a system monospace stack for paths, SHAs, diffs, and code. Theme semantic tokens with CSS variables consumed by Tailwind.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| Canvas | `#17191D` | `#F4F6F8` | Workbench background |
| Surface | `#202329` | `#FFFFFF` | Panels, palette, toolbars |
| Selected surface | `#293649` | `#DFEAFA` | Active row and tab |
| Border | `#393E47` | `#D0D6DE` | Panel dividers and group boundaries |
| Strong border | `#808A99` | `#69778B` | Interactive outlines when required |
| Text | `#E9EDF2` | `#202631` | Main content |
| Muted text | `#AEB8C7` | `#536174` | Secondary labels |
| Link and focus | `#88B9FF` | `#1C57A8` | Link text and visible focus |
| Primary fill | `#2B5FAE` | `#1C57A8` | Primary button with white text |
| Success | `#83CCA2` | `#216747` | Confirmed operations |
| Warning | `#EDC27A` | `#80501B` | Review and attention |
| Error | `#FFA4A7` | `#9C2C3D` | Failures and destructive actions |

Start with a 4 px spacing scale, 1 px borders, 4 px control radius, 13 px body labels, 12 px supporting labels, 16–20 px section titles, and 16 px outline icons. Keep ordinary toolbar and list controls around 28–32 px tall. Use visible 2 px focus rings offset from filled buttons so the ring contrasts with the surrounding surface. Validate final text and control states for WCAG 2.2 AA contrast. Pair state colors with labels or meaningful icons. Respect reduced motion and Windows high-contrast or forced colors. Verify at native scaling and at 200% zoom.

## Workbench layout

Use a compact top context bar, resizable navigation pane, workspace tab strip, main view, and status bar. Reserve secondary panels for features that have working content. Contextual toolbars stay within the view they affect. Display the selected project's name, directory, branch, and working tree state in the top bar. Give truncated paths a full accessible text value and a reveal affordance. Use the status bar for real workspace and preference status. Phase 01 begins with a usable global Home and Settings, an active global Workspace tab, and an honest empty-project context. Phase 02 adds live project tabs and folder operations. Advanced destinations enter the navigation when available.

Support sidebar collapse with a named button and restore the previous width on expand. Provide a keyboard-operable separator with a documented range. Use arrow keys to resize and expose current value with ARIA. When narrow, keep active content and shortcuts usable by collapsing navigation or clipping within data regions with deliberate scrolling. Context menus supplement visible commands and share command registrations and enablement.

## Interaction states

| State | Interaction |
| --- | --- |
| Empty | Explain the current state and show a real next action when one exists. |
| Loading | Keep context visible, mark the busy region, and announce meaningful completion. Support cancel only when the operation can safely cancel. |
| Error | Identify the affected scope, provide a safe retry or recovery route, and preserve input. |
| Warning or conflict | Show affected files or resources, consequence, and explicit choices. Give cancel or back a predictable location. |
| Success | Acknowledge completed verification or a persisted change. Surface partial verification as its own state. |
| Unsupported | Explain the applicable limitation at the point of use and allow inspection where supported. |

The command palette opens with Ctrl+K on Windows and Linux and Cmd+K on macOS. Its combobox and result list support typing, arrow navigation, Enter, Escape, and focus restoration. Use a focus-visible interaction for every actionable item. Keep workspace tab selection accessible with keyboard navigation once multiple tabs are present. Use named dialogs, sensible default focus, and explicit text for actions that change a workspace. Test status announcements, menu keyboard access, and recovery paths as features ship.

## Phase 01 layout bounds

Start expanded at 240 px and use a 180–320 px resize range. Arrow keys adjust by 8 px within the range. Verify the workbench at 1280×800 and 1024×768 CSS pixels, plus a 200% zoom check in a platform capable of running the UI. Settings offers System, Dark, and Light. System follows native color-scheme changes. Persist the theme and last expanded width in local app settings. [Roadmap](ROADMAP.md) defines the exact phase gate.


## Database Studio

Keep source editing, ERD, migration review, and physical observations in separate workbench views. Use the same surface, border, muted text, accent and focus tokens as the project explorer. The tree selects the table inspector. The ERD draws foreign-key links from the model, provides keyboard controls, and indicates draft selection without changing source. Use clear labels for draft, source, pending, applied, unknown and stale states. Native confirmation follows the renderer review for file publication, connection inspection and development apply.
