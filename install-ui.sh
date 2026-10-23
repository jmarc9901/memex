#!/usr/bin/env bash
# Atajo del instalador de la UI. Ej: ./install-ui.sh ~/Documentos
exec node "$(dirname "$0")/scripts/install-ui.js" "$@"
