#!/usr/bin/env bash
VENV="${HOME}/Documents/virtual_environments/general-py312"
SCRIPT="$(dirname "$(realpath "$0")")/dashboard.py"

source "${VENV}/bin/activate"
exec python3 "${SCRIPT}"
