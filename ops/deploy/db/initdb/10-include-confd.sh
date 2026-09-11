#!/bin/bash
# Make the operator's conf.d directory live, ONCE, at cluster creation.
#
# This runs after initdb and before the real server ever starts, which is
# exactly the window the archive settings need — see 10-archive.conf for why
# they cannot be passed on the command line.
set -euo pipefail
CONF="${PGDATA:?}/postgresql.conf"
if ! grep -q "^include_dir = '/etc/postgresql/conf.d'" "$CONF"; then
  printf "\n# Added by 10-include-confd.sh (ops/deploy/db).\ninclude_dir = '/etc/postgresql/conf.d'\n" >> "$CONF"
fi
