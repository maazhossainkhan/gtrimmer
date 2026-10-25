# Google Trim by Shadow — Google Share URL Converter

A responsive, browser-only URL converter inspired by the layout and behavior of the supplied G-URL-CNVT reference website. It uses plain HTML, CSS, and JavaScript—no framework, package installation, database, backend, analytics, or third-party scripts are required.

## Features

- Dark black-and-red neon interface inspired by the reference site
- Responsive layout for desktop and mobile
- Validates the URL host (`share.google` or `www.share.google`)
- Converts the first non-empty path segment into this output format:
  `https://www.google.com/share.google?q=TOKEN`
- Copy button with Clipboard API and a legacy fallback
- Clear/reset action, accessible status/error messages, keyboard form submission, and reduced-motion support
- No network requests are made by the page itself
- Unit tests for core URL-conversion behavior and common invalid inputs

## Brand name

The current brand is **Google Trim by Shadow**. To change it later, edit the heading in `index.html` and update the document `<title>` and description.

## Run locally

You can open `index.html` directly in a browser. For a local web server, run one of these commands from this folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Run tests

Node.js 18 or newer is recommended. From this folder:

```bash
node --test tests/converter.test.cjs
```

## Deploy to GitHub Pages

1. Upload the contents of this folder to the root of a GitHub repository.
2. Open **Settings → Pages** in that repository.
3. Select the `main` branch and `/ (root)` folder, then save.
4. Wait for GitHub Pages to publish the site.

No build step is needed.

## Important behavior and limitations

This implementation intentionally preserves the conversion format used by the supplied reference site's code. It extracts the first non-empty path segment from the input and places that token into the output URL's `q` query parameter. It does **not** follow redirects, discover the original destination, verify that the token is genuine, or check whether the final URL works. Google may change URL routing behavior, so test with real share links before relying on this output in production.

The URL is transformed in the browser. The page does not send the entered value to a server or external analytics service. This does not guarantee the safety of the link itself; inspect unfamiliar links before opening them.
