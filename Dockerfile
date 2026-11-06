FROM caddy:2-alpine
COPY index.html /srv/index.html
# Railway injects $PORT; fall back to 8080 locally
CMD caddy file-server --root /srv --listen :${PORT:-8080}
