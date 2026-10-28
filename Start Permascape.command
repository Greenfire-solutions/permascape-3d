#!/bin/bash
# Backup launcher: double-click this if the Start Permascape icon is ever
# blocked by macOS. It runs exactly the same steps (scripts/start-permascape.sh).
exec /bin/bash "$(cd "$(dirname "$0")" && pwd -P)/scripts/start-permascape.sh" --via-terminal
