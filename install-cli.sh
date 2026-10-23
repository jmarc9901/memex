#!/usr/bin/env bash
# Atajo del instalador del CLI. Ej: ./install-cli.sh
exec node "$(dirname "$0")/scripts/install-cli.js" "$@"
