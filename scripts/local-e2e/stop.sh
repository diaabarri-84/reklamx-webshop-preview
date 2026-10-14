#!/bin/bash
# Stop the local test shop and the emulators started by start.sh.
for port in 3100 8085 9099 9199 4400 4500; do lsof -ti tcp:$port | xargs kill 2>/dev/null || true; done
echo "stopped"
