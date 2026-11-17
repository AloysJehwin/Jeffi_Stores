#!/bin/zsh
# Voices the narration (only lines not voiced yet or changed), builds the timeline and renders each named film into
# out/<film>.mp4, .webm and .jpg (the poster). Usage: ./make-film.sh overview storefront admin campaigns
cd "$(dirname "$0")"
mkdir -p logs out timelines
for f in "$@"; do
  node compose/narrate.mjs narration/$f.json narration/$f > logs/narrate-$f.log 2>&1 || { echo "$f narration FAILED: $(tail -3 logs/narrate-$f.log | tr '\n' ' ')"; exit 1 }
  node compose/build-timeline.mjs plans/$f.json narration/$f clips timelines/$f.json || { echo "$f timeline FAILED"; exit 1 }
  start=$(date +%s)
  node compose/render.mjs timelines/$f.json out/$f > logs/render-$f.log 2>&1 || { echo "$f render FAILED: $(tail -3 logs/render-$f.log | tr '\n' ' ')"; exit 1 }
  echo "$f rendered in $(( $(date +%s) - start ))s"
done
