#!/usr/bin/env python3
"""
Render a viewable graphify HTML for one part of the tree.

The full graph is ~14.7k nodes. graph.html uses vis-network with a force layout and NO
precomputed coordinates, so the browser must stabilise every node before the first paint.
That is what graphify's 5000-node limit protects against — raising it with
GRAPHIFY_VIZ_NODE_LIMIT produces a file whose canvas stays blank while the layout grinds.

This filters the graph to a subdirectory, writes it to its own workspace (so the repo's
graph.json is never touched), and renders there.

  python3 tools/graphify-scope.py src/lib
  python3 tools/graphify-scope.py src/lib/provisioning --hop   # + what it touches

Prints the path to open at the end.
"""
import json, os, shutil, subprocess, sys, tempfile

VIZ_LIMIT = 5000

args = [a for a in sys.argv[1:] if not a.startswith('--')]
prefix = (args[0] if args else 'src/lib').rstrip('/')
src = args[1] if len(args) > 1 else 'graphify-out/graph.json'

g = json.load(open(src))
keep = {n['id'] for n in g['nodes'] if (n.get('source_file') or '').startswith(prefix)}
if not keep:
    sys.exit(f'no nodes under {prefix!r} — check the path')

# --hop pulls in everything the scoped nodes touch. Off by default: on a well-connected area
# one hop can multiply the count several times and put it straight back over the limit.
if '--hop' in sys.argv:
    for l in g.get('links', []):
        s, t = l.get('source'), l.get('target')
        if s in keep or t in keep:
            keep.add(s); keep.add(t)

g['nodes'] = [n for n in g['nodes'] if n['id'] in keep]
g['links'] = [l for l in g.get('links', [])
              if l.get('source') in keep and l.get('target') in keep]

n = len(g['nodes'])
print(f'{prefix}: {n} nodes, {len(g["links"])} links')
if n > VIZ_LIMIT:
    sys.exit(f'  {n} nodes is over the {VIZ_LIMIT} viz limit — narrow the path, or drop --hop')

# Own workspace: graphify writes its output next to the path it is given, so pointing it at
# the repo would overwrite the real graph.json and GRAPH_REPORT.md.
ws = os.path.join(tempfile.gettempdir(), 'graphify-scope', prefix.replace('/', '_'))
shutil.rmtree(ws, ignore_errors=True)
os.makedirs(os.path.join(ws, 'graphify-out'), exist_ok=True)
json.dump(g, open(os.path.join(ws, 'graphify-out', 'graph.json'), 'w'))

subprocess.run(['graphify', 'cluster-only', ws], check=True)
print(f'\nopen {os.path.join(ws, "graphify-out", "graph.html")}')
