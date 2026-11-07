# Waymark

**Use it now: https://dipoafolabi.github.io/Waymark/**

A goal planner: goals with weekly targets and milestones, a calendar that finds open time, reminders, and a weekly review.

It's a static site (HTML, CSS and JavaScript, no build step and no server), so it runs anywhere that can serve files.

## Run it on your computer

Open `index.html` in a browser. That's it.

## Put it online so others can use it

Any static host works. The two simplest:

**GitHub Pages**
1. Create a new public repository and upload these files (keep the `js` folder).
2. In the repository, go to Settings → Pages.
3. Under "Build and deployment", choose "Deploy from a branch", pick `main` and `/ (root)`, then Save.
4. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/`.

**Netlify Drop**
1. Go to app.netlify.com/drop.
2. Drag this whole folder onto the page.
3. You get a live link right away. Sign up for free to keep it and rename it.

## How it works for visitors

- **Data stays in each person's own browser.** Nobody sees anyone else's goals, and there's no account or login. The flip side is no sync between devices. People can move their data with Settings → Export and Import.
- **Clearing browser data erases it.** Encourage people to export a backup now and then.
- **Reminders** go off while a Waymark tab is open. On a real website, desktop alerts work in most browsers once allowed (Settings → Reminders → Turn on desktop alerts).
- **Describe (plain-English adding)** only appears when Waymark is opened inside Claude, because it uses Claude to read the sentence. Outside Claude, the regular Task and Event quick add is shown instead.

## Files

- `index.html` is the page.
- `styles.css` holds all the styles, including dark mode.
- `js/logic.js` holds the scheduling, progress, reminder and repeat rules (no page code).
- `js/store.js` handles saving: Claude sync when inside Claude, otherwise the browser's local storage.
- `js/app.js` draws the screens and handles clicks.
