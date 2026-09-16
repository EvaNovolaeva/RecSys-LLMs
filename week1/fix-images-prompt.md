# Fix Prompt: Replace Font Awesome icons with native emoji

## Context

`week1/index.html` is a single-file Random Lunch Menu Generator.
It currently loads Font Awesome 6.4.0 from a CDN (`cdnjs.cloudflare.com`)
and uses Font Awesome CSS classes for every icon in the app.
Three of those class names (`fa-bowl-hot`, `fa-pasta`, `fa-bowl`) do not
exist in Font Awesome 6, so Ramen, Pasta, and Soup never render an icon.
All icons also disappear whenever the external CDN is unreachable.

## Task

Edit **only** `week1/index.html`. Make the **minimum** set of changes needed
to eliminate the external Font Awesome dependency and replace every icon with
a native Unicode emoji. Do not restructure the HTML or rewrite code that is
not directly affected.

## Exact requirements

1. **Remove the Font Awesome CDN.**
   Delete the `<link>` tag that loads
   `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`.
   No other external resource may be added.

2. **Preserve existing behaviour.** These must remain exactly as they are
   today and must not break:
   - the responsive `@media (max-width: 600px)` CSS;
   - the `Math.random()`-based selection logic;
   - the 500 ms loading delay before the result appears;
   - the `fadeIn` keyframe animation and the `.fade-in` class that triggers it.

3. **Replace `lunchMenu` with name-and-emoji pairs.**
   Store every entry as `{ name, emoji }`. Use these exact pairs:

   | name      | emoji |
   |-----------|-------|
   | Pizza     | 🍕    |
   | Sushi     | 🍣    |
   | Burger    | 🍔    |
   | Salad     | 🥗    |
   | Tacos     | 🌮    |
   | Ramen     | 🍜    |
   | Sandwich  | 🥪    |
   | Pasta     | 🍝    |
   | Curry     | 🍛    |
   | Steak     | 🥩    |
   | Soup      | 🥣    |
   | BBQ       | 🍖    |

4. **Render via `textContent`, not `innerHTML`.**
   After the 500 ms delay, set the food-emoji element's text content to
   the selected `emoji` and the food-name element's text content to
   `Today's pick: [selected name]! 🥳`. Do not use `innerHTML` to
   insert either value.

5. **Emoji in the heading, button, placeholder, and loading state.**
   - Heading: replace the utensils icon (`<i class="fas fa-utensils">`)
     with a single emoji character.
   - Button: replace the random/shuffle icon
     (`<i class="fas fa-random">`) with a single emoji character.
   - Initial placeholder (before the first generation): show an emoji
     instead of the question-mark icon.
   - Loading state (during the 500 ms delay): show an emoji instead of
     the spinning icon.

6. **Disable the button during the delay.**
   At the start of `generateRandomLunch`, set the button's `disabled`
   attribute to `true`. After the 500 ms timeout fires and the result is
   displayed, remove `disabled`.

7. **Accessible markup.**
   - Wrap the generated result (emoji + name) in an element that has
     `role="status"` and `aria-live="polite"` so screen readers announce
     the result without requiring focus.
   - Mark every decorative emoji (`aria-hidden="true"`): the heading
     emoji, the button emoji, and the emoji shown inside the lunch-display
     area. Only the text-result region must be announced.

## What must NOT change

- The file must remain a single self-contained `index.html` with no
  external stylesheets, scripts, or font files.
- The HTML structure (container, h1, description, lunch-display, button,
  footer) must stay recognisably the same.
- The existing inline `<style>` block must be preserved. You may make
  small additions (e.g. styling for the live-region wrapper) but you must
  not remove or restructure existing rules.

## Verification checklist (required before declaring the task done)

Run through every item below. If any check fails, fix the issue and
re-check. **Do not claim success until all checks pass.**

| # | Check | How to verify |
|---|-------|---------------|
| 1 | No Font Awesome references remain | Search the file for `font-awesome`, `cdnjs`, `fas `, `fab `, `<i class`. All must return zero matches. |
| 2 | All 12 menu items display the correct emoji and name | Click "Generate" repeatedly and confirm each pair appears at least once: Pizza 🍕, Sushi 🍣, Burger 🍔, Salad 🥗, Tacos 🌮, Ramen 🍜, Sandwich 🥪, Pasta 🍝, Curry 🍛, Steak 🥩, Soup 🥣, BBQ 🍖. |
| 3 | The result text reads `Today's pick: [name]! 🥳` | Visually inspect or read the DOM after generation. |
| 4 | No external network request for icons | Open the browser Network tab, reload the page, click Generate. Confirm that no request to `cdnjs.cloudflare.com`, `fontawesome.com`, or any icon font CDN appears. Only the initial page load itself should make requests. |
| 5 | Button is disabled during the delay | Click Generate; immediately check that the button shows the disabled state and cannot be clicked again until the result appears. |
| 6 | Fade-in animation works | Confirm the result fades in after the delay. |
| 7 | Responsive layout works | Resize the browser to under 600 px width and confirm the layout adjusts as before. |
| 8 | Live region exists | Inspect the DOM and confirm an element with `role="status"` and `aria-live="polite"` wraps the announced result text. |
| 9 | Decorative emoji hidden from assistive tech | Confirm every emoji other than the live-region result text has `aria-hidden="true"`. |

## Important

- Do **not** fabricate or assume verification results. Each check above
  must actually be performed against the modified file.
- If a check cannot be completed (e.g. browser testing is unavailable),
  state that explicitly rather than inventing a passing result.
