FROM caddy:2.11.4-alpine

COPY site/ /srv/
COPY Caddyfile /etc/caddy/Caddyfile

# A fresh inode does not inherit the source binary's file-capability xattr.
# The service listens on 8080, so it needs no privileged-port capability.
RUN cp /usr/bin/caddy /usr/bin/blitz-caddy \
    && chmod 0755 /usr/bin/blitz-caddy \
    && find /srv -type d -exec chmod 0755 {} \; \
    && find /srv -type f -exec chmod 0644 {} \; \
    && chmod 0644 /etc/caddy/Caddyfile \
    && if command -v getcap >/dev/null 2>&1; then test -z "$(getcap /usr/bin/blitz-caddy)"; fi

USER 1000:1000
ENTRYPOINT ["/usr/bin/blitz-caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
