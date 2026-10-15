#!/bin/bash
# Prints the image tag for HEAD (local-<image_sha>, lib.sh); needs full git history.
source "$(dirname "$0")/../db/lib.sh"
image_tag
