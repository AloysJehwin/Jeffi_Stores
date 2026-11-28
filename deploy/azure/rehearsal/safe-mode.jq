# Rehearsal safe mode, manifest half. Input: the platform manifests as a JSON List (kubectl create --dry-run=client -o json).
# Run with: jq --argjson safe "$(cat safe-env.json)" -f safe-mode.jq
# - every container of every Deployment, StatefulSet, DaemonSet, CronJob and Job gets the kill-switch env (replacing a same-named entry)
# - every CronJob is created suspended
# - messaging, document and voice services (and their edge copies) are created at 0 replicas
# - except the flagship Postgres StatefulSet: a database makes no outbound call, and its OnDelete pod would not pick
#   the env up anyway (verify_pods skips it too)
def names: $safe | map(.name);
def inject: .env = (((.env // []) | map(select((.name as $n | names | index($n)) == null))) + $safe);
def guard:
  if .kind == "StatefulSet" and .metadata.name == "flagship-postgres" then .
  elif .kind == "Deployment" or .kind == "StatefulSet" or .kind == "DaemonSet" then .spec.template.spec.containers |= map(inject)
  elif .kind == "CronJob" then .spec.suspend = true | .spec.jobTemplate.spec.template.spec.containers |= map(inject)
  elif .kind == "Job" then .spec.template.spec.containers |= map(inject)
  else . end;
def parked:
  if .kind == "Deployment" and (.metadata.name | test("-(messaging|document|voice)-service")) then .spec.replicas = 0 else . end;
if .items then .items |= map(guard | parked) else guard | parked end
