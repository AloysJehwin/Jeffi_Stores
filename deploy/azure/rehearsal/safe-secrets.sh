# Rehearsal safe mode, credentials half (sourced by rehearse.sh after common.sh). The pods read their secrets from Key
# Vault at boot (SECRETS_BACKEND=keyvault) and the controller copies store secrets from it, so the live provider
# credentials are not in Kubernetes Secrets but in jeffi-prod-kv. The rehearsal therefore gets its OWN vault: the
# secrets in secret-sources.txt copied FILTERED by the allowlist (secret-keys-keep.txt) minus the denylist
# (secret-keys-deny.txt), and every rehearsal container is pointed at it (AZURE_KEY_VAULT_NAME / _URL, see
# safe-mode.jq). Values only ever pass through 0600 files in a private temp dir and jq; names are printed, values never.
REH_VAULT=${REH_VAULT:-jeffi-reh-kv}
AZ_APPS_IDENTITY=${AZ_APPS_IDENTITY:-jeffi-prod-cluster-apps}
AZ_CONTROLLER_IDENTITY=${AZ_CONTROLLER_IDENTITY:-jeffi-prod-cluster-controller}
KEEP_FILE=$REH_DIR/secret-keys-keep.txt DENY_FILE=$REH_DIR/secret-keys-deny.txt SOURCES_FILE=$REH_DIR/secret-sources.txt

# keep: names and * globs anchored; deny: the lines as they are, joined.
keep_re() { grep -vE '^[[:space:]]*(#|$)' "$KEEP_FILE" | sed -E 's/[.]/\\./g; s/\*/.*/g' | paste -sd'|' - | sed -E 's/^(.*)$/^(\1)$/'; }
deny_re() { grep -vE '^[[:space:]]*(#|$)' "$DENY_FILE" | paste -sd'|' -; }
# Filter on the key NAMES of a JSON object on stdin; the object goes to stdout.
filter_blob() { jq -c --arg keep "$(keep_re)" --arg deny "$(deny_re)" 'with_entries(select((.key | test($keep)) and ((.key | test($deny)) | not)))'; }
dropped_names() { jq -r --arg keep "$(keep_re)" --arg deny "$(deny_re)" '(keys) - (with_entries(select((.key | test($keep)) and ((.key | test($deny)) | not))) | keys) | join(" ")'; }

reh_vault_create() {
  local vid me loc
  if az keyvault show -n "$REH_VAULT" >/dev/null 2>&1; then echo "vault $REH_VAULT exists"
  else
    loc=$(az group show -n "$AZ_RG" --query location -o tsv)
    az keyvault create -n "$REH_VAULT" -g "$AZ_RG" --location "$loc" --enable-rbac-authorization true --retention-days 7 --output none
    echo "created vault $REH_VAULT in $AZ_RG ($loc)"
  fi
  vid=$(az keyvault show -n "$REH_VAULT" --query id -o tsv)
  me=$(az ad signed-in-user show --query id -o tsv)
  az role assignment create --assignee-object-id "$me" --assignee-principal-type User --role "Key Vault Secrets Officer" --scope "$vid" --output none
  az role assignment create --assignee-object-id "$(az identity show -g "$AZ_RG" -n "$AZ_APPS_IDENTITY" --query principalId -o tsv)" \
    --assignee-principal-type ServicePrincipal --role "Key Vault Secrets User" --scope "$vid" --output none
  az role assignment create --assignee-object-id "$(az identity show -g "$AZ_RG" -n "$AZ_CONTROLLER_IDENTITY" --query principalId -o tsv)" \
    --assignee-principal-type ServicePrincipal --role "Key Vault Secrets Officer" --scope "$vid" --output none
}

reh_copy_secret() { # <name> [verbatim]
  local n=$1 mode=${2:-filter} f="$SHIM_DIR/secret-$1.json" i dropped
  az keyvault secret show --vault-name "$AZ_KEY_VAULT" --name "$n" --query value -o tsv > "$f" || { echo "cannot read $n in $AZ_KEY_VAULT" >&2; return 1; }
  if [ "$mode" = verbatim ]; then echo "$n: copied verbatim (infrastructure)"
  else
    # never write the unfiltered blob: a secret that is not a JSON object stops here
    dropped=$(dropped_names < "$f") && filter_blob < "$f" > "$f.out" || { rm -f "$f" "$f.out"; echo "$n is not a JSON object, not copied" >&2; return 1; }
    echo "$n: kept $(jq 'length' "$f.out") key(s); dropped: $dropped"
    mv "$f.out" "$f"
  fi
  # a new role assignment takes a minute or two to reach the data plane
  for i in 1 2 3 4 5 6 7 8; do
    az keyvault secret set --vault-name "$REH_VAULT" --name "$n" --file "$f" --encoding utf-8 --output none 2>/dev/null && { rm -f "$f"; return 0; }
    sleep 20
  done
  rm -f "$f"; echo "could not write $n to $REH_VAULT" >&2; return 1
}
reh_vault_fill() {
  local n mode
  while read -r n mode; do
    case $n in ''|'#'*) continue ;; esac
    reh_copy_secret "$n" "$mode"
  done < "$SOURCES_FILE"
}

# Fails the run if any dropped (or unlisted) key exists in the rehearsal vault, or any Kubernetes Secret of the
# platform or a store carries a denied key or is google-sa. Names are printed, values never.
verify_secrets() {
  local bad=0 n keys hit
  for n in $(az keyvault secret list --vault-name "$REH_VAULT" --query '[].name' -o tsv); do
    case $n in *-k3s) continue ;; esac
    keys=$(az keyvault secret show --vault-name "$REH_VAULT" --name "$n" --query value -o tsv | jq -r 'keys[]' 2>/dev/null) || continue
    hit=$(printf '%s\n' "$keys" | grep -E "$(deny_re)" || true)
    [ -z "$hit" ] || { echo "vault secret $n holds denied key(s): $(echo $hit)" >&2; bad=1; }
    hit=$(printf '%s\n' "$keys" | grep -vE "$(keep_re)" || true)
    [ -z "$hit" ] || { echo "vault secret $n holds key(s) outside the allowlist: $(echo $hit)" >&2; bad=1; }
  done
  hit=$(kubectl get secrets -A -o json | jq -r --arg deny "$(deny_re)" '
    .items[] | select(.metadata.namespace | test("^(jeffi|jeffi-edge|tenant-.*)$"))
    | .metadata.namespace as $ns | .metadata.name as $s
    | (if $s == "google-sa" then "\($ns)/\($s) must not exist" else empty end),
      ((.data // {}) | keys[] | select(test($deny)) | "\($ns)/\($s) holds denied key \(.)")')
  [ -z "$hit" ] || { echo "$hit" >&2; bad=1; }
  [ "$bad" = 0 ] && echo "no denied credential in the rehearsal vault $REH_VAULT or in any platform or store Secret"
  return $bad
}
