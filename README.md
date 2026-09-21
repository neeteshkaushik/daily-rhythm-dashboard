# Daily Rhythm dashboard

This is a static, read-only dashboard. Open `index.html` with any static file host or deploy this folder to GitHub Pages, Netlify, or Vercel.

The dashboard fetches the configured public Google Sheet directly and never writes data. The source sheet ID and tab ID are at the top of `app.js`.

Score weights: sleep duration 25, bedtime 15, wake time 10, study time 30, screen time 20. Daily context is display-only.
