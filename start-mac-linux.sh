#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
echo "Wishloom: http://127.0.0.1:8080"
exec python3 app.py
