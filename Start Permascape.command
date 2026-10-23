#!/bin/bash
# Same as double-clicking "Start Permascape". All logic lives in scripts/start-permascape.sh.
exec /bin/bash "$(dirname "$0")/scripts/start-permascape.sh"
