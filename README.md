# ✳ Wishloom — Your private wishlist (v5)

This is an updated version of the original Wishloom website. It uses standard Python and JavaScript and has **no example wishes**, no search bar, no account creation screen, and no database service required.

The homepage no longer displays the "PRIVATE BY LINK" indicator or the "Copy private link" button beside "New wish". The top-right "Share wishlist" control is retained for sharing.

## The experience

1. Open `http://127.0.0.1:8080`. The website automatically makes a new, empty private wishlist on the first visit and opens its real homepage. Further visits from the same browser reopen that wishlist. No setup questionnaire or demo cards.
2. Click **+ New wish**. Add a name, desire rating **1–10**, optional description (such as color, size or model), optional estimated **EUR** price, and up to eight shopping/Instagram/product links.
3. Each wish becomes a card with a product picture if available, a **price-tier color in the upper left**, and a desire score in the **upper right**. Click it to flip to the full details and links.
4. Click the small **○ Mark** circle on one or more cards to reveal a toolbar: **Adjust**, **Complete** and **Remove**. Adjust requires only one selection. Complete moves the card into the smaller, separately labeled **COMPLETED** grid further down.
5. Completed cards can still flip. Mark them to **Add again**, **Adjust**, or **Remove**. Deleting is confirmed. Changes persist in the SQLite database.
6. Use the **single dropdown** on the homepage to show **Highest desire** (default), **Must have it** (8–10), **Want it** (4–7), **Maybe someday** (1–3), **Newest first**, **Oldest first**, **Price: low to high**, or **Name A–Z**. The three desire categories filter active wishes; sorting choices show all active wishes. Completed wishes always remain visible in their separate section.
7. Use **Share wishlist** to copy the unlisted URL. Anyone with that exact link can view and edit the same wishlist, including from other devices. They do *not* need an account.

### Price tiers (estimated EUR)

The theme uses a dark violet background with orchid-pink accents, periwinkle Tier 1, and coordinated purple/blue/pink placeholder artwork. No green UI accents remain. All behaviors and existing wishlist data are unchanged.

- **Periwinkle / Tier 1:** €0 through €20 inclusive
- **Yellow / Tier 2:** over €20 through €50
- **Orange / Tier 3:** over €50 through €75
- **Red / Tier 4:** over €75
- **Neutral:** no estimated price entered

## Run locally — Windows

Requires Python **3.10+**. Unzip this folder, double-click **`start-windows.bat`**, and open **http://127.0.0.1:8080** in your browser.

Or open a terminal in the `wishloom` folder:

```powershell
py -3 app.py
```

For macOS/Linux, execute `./start-mac-linux.sh` or run `python3 app.py`.

Data is kept in `data/wishloom.sqlite3`, so restarting the application won't remove your wishes. Existing v1 data is migrated non-destructively (new completion and image fields are added). Do not delete the database file if you want to keep your lists.

## Automatic pictures — important

Wishloom has a two-stage automatic picture system:

1. **Product page image (no API key):** When a wish includes a product, store, or Instagram link, the server attempts to read a usable `og:image`/`twitter:image` thumbnail from the page and displays it. Sites may block scraping or not provide image metadata, so this is best-effort and cannot always find a picture.
2. **AI-generated product illustration (optional):** If no linked product image is found, the server can generate a photorealistic picture using the wish's **name, description, and link context**. To enable this, set the `OPENAI_API_KEY` environment variable **on the server only**. The default image model is `gpt-image-1`, configurable via `OPENAI_IMAGE_MODEL`. **AI images incur usage charges billed by the API provider.**

Without an API key or a usable linked image, each wish has a colorful designed placeholder, not a falsely labeled AI-generated picture. You can also choose **Have a specific product photo?** in the form and paste a direct image URL. Automatic images populate shortly after saving; no action is required. Refresh the page if a newly generated photo does not appear immediately.

**Do not put an API key in the JavaScript or share it with friends.** For example, on Windows PowerShell, before starting Wishloom:

```powershell
$env:OPENAI_API_KEY="YOUR_SECRET_API_KEY"
py -3 app.py
```

On macOS/Linux:

```bash
OPENAI_API_KEY="YOUR_SECRET_API_KEY" python3 app.py
```

If you don't want API costs, simply leave that variable unset. **Product-link pictures still work without it** where the linked website exposes a thumbnail.

## Docker and internet sharing

```bash
docker compose up -d --build
```

Docker Compose binds to **127.0.0.1:8080** and stores data in a persistent Docker volume. To use the optional AI-image feature with Docker Compose, add `OPENAI_API_KEY=${OPENAI_API_KEY}` to the service environment and set that variable on your host; **never commit or publish the API key**.

For other people to use a private URL from their own devices, **you must deploy the server online behind HTTPS with persistent storage**, for example using a VPS and Caddy:

```caddyfile
wishlist.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Configure DNS, firewall, and a domain in place of the example. Do not use unencrypted HTTP on the public internet; a secret URL transmitted over HTTP is not private.

## How private is it?

Every wishlist URL contains a cryptographically random secret token. The database stores a **hash of that token**. There is no public listing of all wishlists; all list reads and changes require the token; pages include `noindex` and `no-referrer` headers.

**Privacy is by possession of the link — not by verified identity.** Someone who receives or forwards the URL has **full editing permission**, including deleting cards. There are no individual invitations, view-only roles, undo history, or separate user accounts. Protect the URL like a password. A lost URL cannot currently be retrieved by an administrator from the hashed database, so save your private link. The homepage uses a browser-local pointer to remember your URL; clearing site storage may lose that pointer, but does not delete the server-side list.

Using external product image links may reveal the viewer's IP to image hosting services, and website thumbnail lookup reveals the **server's IP** to the linked website. Enabling AI generation sends item text to the configured image API. There are no third-party scripts, analytics, or tracking cookies. Keep database backups.

## Technology and endpoints

- Python 3.10+, standard library; server-side SQLite (no external packages)
- HTML, CSS and vanilla JavaScript, responsive on desktop and mobile
- `POST /api/wishlists` creates a private room and returns `/w/<token>`
- `GET /api/w/<token>` lists wishes
- `PATCH /api/w/<token>` renames the room
- `POST /api/w/<token>/items` creates a wish
- `PUT /api/w/<token>/items/<id>` edits a wish
- `PATCH /api/w/<token>/items/<id>` updates `{ "completed": true/false }`
- `DELETE /api/w/<token>/items/<id>` deletes a wish
- AI pictures are served only via room-token-verified URLs.

This is a personal/small-group application, not a high-traffic production service. Before scaling, add stronger operational safeguards such as rate limiting on room creation and image generation, security review of link thumbnail scraping, backups, and better access management if you need individual user permissions.
