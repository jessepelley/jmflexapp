# JM Flex App

A fast, offline-first fitness tracking app built for iPad and iPhone. Trainers use it to record and compare client personal bests across exercises, track leaderboards by gender and category, and manage client sessions — all from a clean mobile web interface.

**Live app:** [jmflexapp.jjjp.ca](https://jmflexapp.jjjp.ca)

---

## Features

- **Leaderboard** — Top 10 most-active exercises, filterable by category (Back, Legs, Chest, etc.) and gender (M/F). Shows gold medal holder with weight, reps, and volume.
- **Personal Bests** — One record per client per exercise (their all-time best). New number ones trigger a confetti animation.
- **Client Profiles** — View all of a client's personal bests in one place, with total volume stats.
- **Exercises** — Full exercise library organised by category with CSV import/export.
- **Session Mode** — Focus the app on a single client: the leaderboard filters to their gender and the Add Record form pre-fills their name.
- **Server Sync** — Bi-directional sync with a backend API every 30 seconds. Works fully offline and syncs when back online.
- **CSV Import/Export** — Bulk-import clients or exercises from spreadsheets; export anytime.
- **Full Data Backup** — Export/import the complete dataset as JSON.

---

## Tech Stack

- Vanilla JavaScript (no frameworks)
- CSS3 with custom properties, Grid, Flexbox, and backdrop-filter
- `localStorage` for offline persistence
- Fetch API for server sync
- Canvas API for confetti

No build step required — open `index.html` directly or serve the three files (`index.html`, `app.js`, `styles.css`) from any static host.

---

## Getting Started

1. Open the app in Safari on iPad or iPhone (or any modern browser).
2. Enter your **Server URL** and **API Key** on the setup screen.
3. Tap **CONNECT** — the app syncs and is ready to use.

If you don't have a backend, you can still use the app fully offline; data is stored in `localStorage` and export/import keeps it safe.

---

## Usage

### Adding a Record
Tap the **＋** button in the bottom nav. Search for a client, search for an exercise, then enter weight and reps via the custom numeric keypad. Tap **SAVE RECORD** — if it's a new personal best you'll see confetti if it's also a new #1 on the leaderboard.

### Client Detail View
On the **Clients** tab, tap any client card to open their profile. You'll see their stats (total personal bests and total volume) and a ranked list of all their lifts.

### Session Mode
On a client's profile (or from the Clients list), tap **Session** to lock the app to that client. A banner appears at the top and the Add Record form pre-selects them. Tap **End Session** in the banner or on the Settings tab to return to normal mode.

### Gender Filter
The **M | F** toggle in the header filters the leaderboard and client lists. Tap to switch between male and female views.

---

## Version History

| Version | Changes |
|---------|---------|
| **v2.0** | Client detail / profile view; fixed search-field single-character bug; cache-busting version query strings; version history on Settings tab |
| **v1.0** | Initial release — leaderboard, personal bests, client & exercise management, session mode, server sync, CSV & JSON import/export, confetti |

---

## Project Structure

```
jmflexapp/
├── index.html   — App shell: HTML structure, modals, nav
├── app.js       — All application logic (~1 800 lines, vanilla JS)
├── styles.css   — Complete design system (dark theme, mobile-first)
├── logo.png     — Brand logo
└── CNAME        — GitHub Pages custom domain (jmflexapp.jjjp.ca)
```

---

## License

Private project — all rights reserved.
