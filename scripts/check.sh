#!/usr/bin/env sh
set -eu

node --check app/*.js
jq empty app/data/diary.json

references=$(rg -o '(<(?:script|link)[^>]+(?:src|href)=")[^"]+' app/index.html | sed -E 's/.*="//' | sort -u)
for reference in $references; do
  case "$reference" in
    http://*|https://*|//*)
      echo "External runtime reference found: $reference" >&2
      exit 1
      ;;
    *)
      test -f "app/$reference" || { echo "Missing referenced file: app/$reference" >&2; exit 1; }
      ;;
  esac
done

if rg -n --glob '*.{html,css,js}' 'https?://' app; then
  echo "External runtime URL found." >&2
  exit 1
fi

echo "check.sh: syntax, JSON, local paths, and runtime URLs passed"
