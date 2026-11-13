#!/usr/bin/env python3
"""A one-off Job from a platform Deployment's pod: its image, env, secrets, service account and placement. The
release's database stage runs the tenant fan-out this way, in the release's controller image, before that
controller rolls out. The pod carries its own label only, so no Service, HPA or PDB selects it; no probes,
never restarted, deleted a day after it finishes.
Usage: kubectl create --dry-run=client -f - -o json | release-job.py <deployment> <job> <sh script> [KEY=VALUE ...]
"""
import json
import sys

dep_name, job_name, script, *env = sys.argv[1:]
doc = json.load(sys.stdin)
items = doc.get('items', [doc])
dep = next((o for o in items if o.get('kind') == 'Deployment' and o['metadata']['name'] == dep_name), None)
if dep is None:
    sys.exit(f'no Deployment {dep_name} in the rendered manifests')
pod = dep['spec']['template']['spec']
c = pod['containers'][0]
for k in ('startupProbe', 'readinessProbe', 'livenessProbe', 'lifecycle', 'ports'):
    c.pop(k, None)
c['command'] = ['sh', '-c', script]
c['env'] = c.get('env', []) + [{'name': k, 'value': v} for k, v in (e.split('=', 1) for e in env)]
pod['containers'] = [c]
pod['restartPolicy'] = 'Never'
pod.pop('terminationGracePeriodSeconds', None)
labels = {'jeffi.io/release-job': job_name}
json.dump({
    'apiVersion': 'batch/v1',
    'kind': 'Job',
    'metadata': {'name': job_name, 'namespace': dep['metadata']['namespace'], 'labels': labels},
    'spec': {
        'backoffLimit': 0,
        'activeDeadlineSeconds': 3600,
        'ttlSecondsAfterFinished': 86400,
        'template': {'metadata': {'labels': labels}, 'spec': pod},
    },
}, sys.stdout)
