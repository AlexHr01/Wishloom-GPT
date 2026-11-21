#!/usr/bin/env python3
"""Wishloom: private-link wishlist with optional automatic link/AI imagery."""
from __future__ import annotations

import base64
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener, urlopen

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get('WISHLOOM_DB', str(ROOT / 'data' / 'wishloom.sqlite3')))
MEDIA = DATABASE.parent / 'images'
HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8080'))
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{40,60}$')
ITEM_RE = re.compile(r'^[0-9a-f]{32}$')


def db():
    con = sqlite3.connect(DATABASE, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=15000')
    return con


def setup():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript('''
          CREATE TABLE IF NOT EXISTS wishlists (
            token_hash TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL REFERENCES wishlists(token_hash) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            emoji TEXT NOT NULL,
            image_url TEXT NOT NULL,
            score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
            price_min REAL,
            price_max REAL,
            currency TEXT NOT NULL,
            links TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_items_room ON items(token_hash, created_at DESC);
        ''')
        # Older installs retain their wishlists and saved items.
        columns = {row['name'] for row in con.execute('PRAGMA table_info(items)')}
        for col, definition in (
            ('completed', 'INTEGER NOT NULL DEFAULT 0'),
            ('completed_at', 'TEXT'),
            ('image_source', "TEXT NOT NULL DEFAULT ''"),
        ):
            if col not in columns:
                con.execute(f'ALTER TABLE items ADD COLUMN {col} {definition}')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def token_digest(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def valid_http_url(raw):
    if not isinstance(raw, str):
        return False
    try:
        p = urlsplit(raw.strip())
        return p.scheme in ('https', 'http') and bool(p.hostname) and not p.username and not p.password
    except ValueError:
        return False


def safe_public_url(raw):
    """Protect the metadata-fetcher from local/private network URLs."""
    if not valid_http_url(raw):
        return False
    try:
        p = urlsplit(raw.strip())
        if p.port not in (None, 80, 443):
            return False
        if p.hostname.lower() in ('localhost',) or p.hostname.lower().endswith(('.local', '.internal')):
            return False
        addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(row[4][0]).is_global for row in addresses)
    except (OSError, ValueError, TypeError):
        return False


class SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not safe_public_url(newurl):
            raise ValueError('Unsafe redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class ImageMetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'meta':
            return
        data = {k.lower(): v for k, v in attrs if k and v}
        key = (data.get('property') or data.get('name') or '').lower()
        if key in ('og:image:secure_url', 'og:image', 'twitter:image') and data.get('content'):
            self.images.append(data['content'])


def discover_link_image(links):
    opener = build_opener(SafeRedirects())
    for link in links[:3]:
        url = link.get('url', '')
        if not safe_public_url(url):
            continue
        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; WishloomPreview/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            })
            with opener.open(req, timeout=6) as response:
                if 'html' not in response.headers.get('Content-Type', '').lower():
                    continue
                html = response.read(400_000).decode('utf-8', errors='replace')
                base = response.geturl()
            parser = ImageMetadataParser()
            parser.feed(html)
            for candidate in parser.images:
                image_url = urljoin(base, candidate)
                if len(image_url) <= 1600 and safe_public_url(image_url):
                    return image_url
        except (OSError, HTTPError, URLError, UnicodeError, ValueError, TimeoutError):
            continue
    return None


def make_ai_image(item_id, name, description, links):
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        return None
    context = ', '.join(link.get('label', '') + ': ' + urlsplit(link.get('url', '')).hostname
                        for link in links[:3] if valid_http_url(link.get('url', '')))
    prompt = (
        'Create a single photorealistic, premium editorial product photograph of the following wished-for item. '
        'The main object must be visually clear and centered; clean contemporary studio lighting, tasteful soft shadows, '
        'simple complementary background, absolutely no text, typography, logos, watermark or collage. '
        'Respect model, material, color or size when described. '
        f'Item: {name[:100]}. Details: {description[:500] or "No other specifications"}. '
        f'Potential shopping context: {context[:250] or "none"}.'
    )
    payload = json.dumps({
        'model': os.environ.get('OPENAI_IMAGE_MODEL', 'gpt-image-1'),
        'prompt': prompt,
        'size': '1024x1024',
        'quality': 'low',
        'n': 1,
    }).encode('utf-8')
    request = Request('https://api.openai.com/v1/images/generations', data=payload, headers={
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
    })
    try:
        with urlopen(request, timeout=125) as result:
            data = json.loads(result.read(14_000_000))
        raw = data['data'][0]['b64_json']
        binary = base64.b64decode(raw, validate=True)
        if not binary.startswith(b'\x89PNG\r\n\x1a\n') or len(binary) > 12_000_000:
            return None
        filepath = MEDIA / f'{item_id}.png'
        filepath.write_bytes(binary)
        return 'ai'
    except (OSError, ValueError, KeyError, IndexError, HTTPError, URLError) as exc:
        print('Optional image generation unavailable:', str(exc)[:160], file=sys.stderr)
        return None


def image_worker(digest, item_id, name, description, links, previous_url):
    """Resolve images after saving. Never overwrite a subsequent user edit."""
    found = discover_link_image(links)
    source = 'link' if found else ''
    if not found and os.environ.get('OPENAI_API_KEY'):
        source = make_ai_image(item_id, name, description, links) or ''
        if source:
            found = f'/api/image/{item_id}'
    with db() as con:
        con.execute('''UPDATE items SET image_url=?, image_source=?
            WHERE id=? AND token_hash=? AND image_url=? AND image_source='pending'
            AND name=? AND description=? AND links=?''',
            (found or '', source or 'none', item_id, digest, previous_url, name, description, json.dumps(links, ensure_ascii=False)))


def trigger_image(digest, item_id, fields, old_url=''):
    if fields['image_url']:
        return
    links = json.loads(fields['links'])
    threading.Thread(target=image_worker, args=(digest, item_id, fields['name'], fields['description'], links, old_url), daemon=True).start()


def clean_item(raw):
    if not isinstance(raw, dict):
        raise ValueError('Invalid item data.')
    name = str(raw.get('name') or '').strip()
    if not 1 <= len(name) <= 100:
        raise ValueError('Give your wish a name (max 100 characters).')
    description = str(raw.get('description') or '').strip()
    image_url = str(raw.get('image_url') or '').strip()
    if len(description) > 800 or len(image_url) > 1600:
        raise ValueError('A field is too long.')
    if image_url and not valid_http_url(image_url):
        raise ValueError('The custom image URL must start with https:// or http://.')
    score = raw.get('score')
    if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 10:
        raise ValueError('Desire rating must be between 1 and 10.')
    value = raw.get('price')
    if value in (None, ''):
        price = None
    else:
        if isinstance(value, bool):
            raise ValueError('Enter a valid price.')
        try:
            price = float(value)
        except (TypeError, ValueError):
            raise ValueError('Enter a valid price.') from None
        if not (0 <= price <= 10_000_000):
            raise ValueError('Price must be between 0 and 10,000,000 EUR.')
        price = round(price, 2)
    incoming_links = raw.get('links') or []
    if not isinstance(incoming_links, list) or len(incoming_links) > 8:
        raise ValueError('Up to eight links per wish, please.')
    links = []
    for link in incoming_links:
        if not isinstance(link, dict):
            raise ValueError('Invalid link.')
        label = str(link.get('label') or '').strip()
        url = str(link.get('url') or '').strip()
        if not label and not url:
            continue
        if not url or len(url) > 1800 or not valid_http_url(url):
            raise ValueError('Each link needs a valid http(s) address.')
        if len(label) > 65:
            raise ValueError('Link name must be 65 characters or shorter.')
        links.append({'label': label or 'Shopping link', 'url': url})
    return {
        'name': name, 'description': description, 'category': 'Wish', 'emoji': '✳',
        'image_url': image_url, 'image_source': 'manual' if image_url else 'pending',
        'score': score, 'price_min': price, 'price_max': None, 'currency': 'EUR',
        'links': json.dumps(links, ensure_ascii=False),
    }


def item_json(row, token):
    result = dict(row)
    result.pop('token_hash', None)
    result['links'] = json.loads(result['links'])
    result['price'] = result.pop('price_min')
    result.pop('price_max', None)
    result['completed'] = bool(result['completed'])
    if result['image_source'] == 'ai':
        result['image_url'] = '/api/w/' + token + '/images/' + result['id'] + '.png'
    return result


class Handler(__import__('http.server', fromlist=['BaseHTTPRequestHandler']).BaseHTTPRequestHandler):
    server_version = 'Wishloom'
    sys_version = ''

    def log_message(self, format, *args):
        # Secret URLs shouldn't appear in application logs.
        pass

    def respond_headers(self, content_type='application/json; charset=utf-8', status=200, length=0):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Robots-Tag', 'noindex, nofollow, noarchive')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()

    def send_json(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.respond_headers(status=status, length=len(data))
        self.wfile.write(data)

    def fail(self, message, status=400):
        self.send_json({'error': message}, status)

    def read_json(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValueError('Invalid request body.') from None
        if not 0 < size <= 24_000:
            raise ValueError('Request body must be smaller than 24 KB.')
        try:
            return json.loads(self.rfile.read(size))
        except (UnicodeError, json.JSONDecodeError):
            raise ValueError('Invalid JSON.') from None

    def get_room(self, token):
        if not TOKEN_RE.fullmatch(token):
            return None
        with db() as con:
            return con.execute('SELECT * FROM wishlists WHERE token_hash=?', (token_digest(token),)).fetchone()

    def route(self, method):
        path = urlsplit(self.path).path
        if method == 'GET' and path in ('/', '/favicon.svg', '/static/styles.css', '/static/app.js'):
            file_path = ROOT / ('static/index.html' if path == '/' else path.lstrip('/'))
            if not file_path.is_file():
                return self.fail('File not found.', 404)
            data = file_path.read_bytes()
            typ = mimetypes.guess_type(file_path.name)[0] or 'application/octet-stream'
            self.respond_headers(typ + ('; charset=utf-8' if typ.startswith('text/') or typ in ('application/javascript', 'image/svg+xml') else ''), length=len(data))
            self.wfile.write(data)
            return
        if method == 'GET' and path.startswith('/w/'):
            token = path.removeprefix('/w/')
            if not self.get_room(token):
                return self.fail('That private wishlist does not exist.', 404)
            data = (ROOT / 'static/index.html').read_bytes()
            self.respond_headers('text/html; charset=utf-8', length=len(data))
            self.wfile.write(data)
            return
        if method == 'POST' and path == '/api/wishlists':
            raw = self.read_json()
            title = str(raw.get('title') or 'My wishlist').strip() if isinstance(raw, dict) else ''
            if not 1 <= len(title) <= 70:
                raise ValueError('Wishlist title must be 1–70 characters.')
            token = secrets.token_urlsafe(32)
            with db() as con:
                con.execute('INSERT INTO wishlists(token_hash,title,created_at) VALUES(?,?,?)', (token_digest(token), title, now()))
            return self.send_json({'url': '/w/' + token}, 201)
        image_match = re.fullmatch(r'/api/w/([A-Za-z0-9_-]+)/images/([0-9a-f]{32})\.png', path)
        if method == 'GET' and image_match:
            token, item_id = image_match.groups()
            if not self.get_room(token):
                return self.fail('Not found.', 404)
            with db() as con:
                row = con.execute('SELECT image_source FROM items WHERE token_hash=? AND id=?', (token_digest(token), item_id)).fetchone()
            image_path = MEDIA / (item_id + '.png')
            if not row or row['image_source'] != 'ai' or not image_path.is_file():
                return self.fail('Not found.', 404)
            data = image_path.read_bytes()
            self.respond_headers('image/png', length=len(data))
            self.wfile.write(data)
            return
        m = re.fullmatch(r'/api/w/([A-Za-z0-9_-]+)(?:/items(?:/([0-9a-f]+))?)?', path)
        if not m:
            return self.fail('Not found.', 404)
        token, item_id = m.groups()
        room = self.get_room(token)
        if room is None:
            return self.fail('This private wishlist is not available.', 404)
        digest = token_digest(token)
        root = path == '/api/w/' + token
        list_path = path == '/api/w/' + token + '/items'
        if method == 'GET' and root:
            with db() as con:
                items = con.execute('SELECT * FROM items WHERE token_hash=? ORDER BY created_at DESC', (digest,)).fetchall()
            return self.send_json({'title': room['title'], 'items': [item_json(row, token) for row in items]})
        if method == 'PATCH' and root:
            raw = self.read_json()
            title = str(raw.get('title') or '').strip() if isinstance(raw, dict) else ''
            if not 1 <= len(title) <= 70:
                raise ValueError('Wishlist title must be 1–70 characters.')
            with db() as con:
                con.execute('UPDATE wishlists SET title=? WHERE token_hash=?', (title, digest))
            return self.send_json({'title': title})
        if method == 'POST' and list_path:
            fields = clean_item(self.read_json())
            item_id = uuid.uuid4().hex
            stamp = now()
            with db() as con:
                cols = ['id', 'token_hash', *fields.keys(), 'created_at', 'updated_at']
                con.execute(f"INSERT INTO items ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})", [item_id, digest, *fields.values(), stamp, stamp])
                row = con.execute('SELECT * FROM items WHERE id=?', (item_id,)).fetchone()
            trigger_image(digest, item_id, fields)
            return self.send_json(item_json(row, token), 201)
        if item_id and ITEM_RE.fullmatch(item_id):
            if method == 'PUT':
                fields = clean_item(self.read_json())
                fields['updated_at'] = now()
                with db() as con:
                    previous = con.execute('SELECT * FROM items WHERE id=? AND token_hash=?', (item_id, digest)).fetchone()
                    if previous is None:
                        return self.fail('That wish no longer exists.', 404)
                    # Keep old auto image if the subject is unchanged; refresh otherwise.
                    same_subject = (fields['name'] == previous['name'] and fields['description'] == previous['description'] and fields['links'] == previous['links'])
                    if not fields['image_url'] and same_subject and previous['image_url'] and previous['image_source'] != 'manual':
                        fields['image_url'] = previous['image_url']
                        fields['image_source'] = previous['image_source']
                    con.execute('UPDATE items SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=? AND token_hash=?', (*fields.values(), item_id, digest))
                    row = con.execute('SELECT * FROM items WHERE id=? AND token_hash=?', (item_id, digest)).fetchone()
                if not fields['image_url']:
                    trigger_image(digest, item_id, fields)
                return self.send_json(item_json(row, token))
            if method == 'PATCH':
                raw = self.read_json()
                if not isinstance(raw, dict) or type(raw.get('completed')) is not bool:
                    raise ValueError('Set completed to true or false.')
                completed = 1 if raw['completed'] else 0
                with db() as con:
                    cursor = con.execute('UPDATE items SET completed=?, completed_at=?, updated_at=? WHERE token_hash=? AND id=?',
                        (completed, now() if completed else None, now(), digest, item_id))
                    row = con.execute('SELECT * FROM items WHERE id=? AND token_hash=?', (item_id, digest)).fetchone() if cursor.rowcount else None
                if row is None:
                    return self.fail('That wish no longer exists.', 404)
                return self.send_json(item_json(row, token))
            if method == 'DELETE':
                with db() as con:
                    cursor = con.execute('DELETE FROM items WHERE token_hash=? AND id=?', (digest, item_id))
                if not cursor.rowcount:
                    return self.fail('That wish no longer exists.', 404)
                (MEDIA / (item_id + '.png')).unlink(missing_ok=True)
                return self.send_json({'deleted': True})
        return self.fail('Not found.', 404)

    def handle_request(self, method):
        try:
            return self.route(method)
        except ValueError as exc:
            self.fail(str(exc), 400)
        except (sqlite3.Error, OSError) as exc:
            print('Wishloom server error:', exc, file=sys.stderr)
            self.fail('Unexpected server error.', 500)

    def do_GET(self): self.handle_request('GET')
    def do_POST(self): self.handle_request('POST')
    def do_PUT(self): self.handle_request('PUT')
    def do_PATCH(self): self.handle_request('PATCH')
    def do_DELETE(self): self.handle_request('DELETE')


if __name__ == '__main__':
    from http.server import ThreadingHTTPServer
    setup()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'\n  ✳ Wishloom: http://{HOST}:{PORT}\n  Deploy with HTTPS for sharing.\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
