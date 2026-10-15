#!/bin/bash
# Kept for muscle memory: the release is now release.sh (four service images + rollout + smoke test).
exec bash "$(dirname "$0")/release.sh" "$@"
