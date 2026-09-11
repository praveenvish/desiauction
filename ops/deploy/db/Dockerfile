# Postgres, plus the one binary the archive command calls.
#
# `archive_command` runs INSIDE THIS CONTAINER, not in the pgbackrest sidecar.
# The stack ran `postgres:17-alpine` with
# `archive_command=pgbackrest --stanza=desiauction archive-push %p` and that
# image has no pgbackrest, so every segment failed with exit code 127. Postgres
# does not recycle a WAL segment until it has been archived, so the failure is
# not "backups are missing" — it is a disk that fills until the database stops
# accepting writes. Measured on the real image: 13 segments stuck `.ready` and
# 224MB of WAL against a 64MB target, still climbing.
#
# Debian rather than Alpine because PGDG packages pgbackrest for it (2.59.x),
# and the database is the last place to hand-build a dependency.
FROM postgres:17

# Pinned to the major so a rebuild cannot silently move the tool that owns the
# only rollback this deployment has. PGDG is already configured in this image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends pgbackrest; \
    rm -rf /var/lib/apt/lists/*; \
    pgbackrest version

# The one-shot that makes conf.d live. Runs after initdb, before the real
# server — which is the only window in which the archive settings can be added
# without deadlocking the entrypoint's temporary server.
COPY initdb/10-include-confd.sh /docker-entrypoint-initdb.d/10-include-confd.sh
