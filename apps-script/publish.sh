#!/usr/bin/env bash
# Publish the current code to the public Academy link (/exec) WITHOUT changing its URL.
# Uses one of the project's 200 versions, so run it only when a build is final.
# Day-to-day work just needs `clasp push` — triggers and the /dev link always run the latest push.
set -euo pipefail
cd "$(dirname "$0")"
EXEC_ID=$(grep -oP "ACADEMY_EXEC_ID = '\K[^']+" WebApp.js)
DESC="${1:?usage: ./publish.sh \"what changed\"}"
clasp push --force
VER=$(clasp create-version "$DESC" | grep -oP '\d+' | tail -1)
clasp update-deployment "$EXEC_ID" --versionNumber "$VER" --description "$DESC"
echo "Published version $VER to https://script.google.com/macros/s/$EXEC_ID/exec"
