// Prints the k3s agent join script for one node from node-user-data.ts (the same cross-cloud join the controller puts in a
// new node's user-data). The spec, with the k3s token and Tailscale key under `join`, arrives on stdin, never in argv;
// the output goes to a 0600 file made by stores.sh. Usage: tsx deploy/azure/cutover/join-script.ts < spec.json > join.sh
import { agentNodeUserData, type AgentNodeSpec } from '../../../packages/store-core/src/lib/k8s/node-user-data'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c: string) => {
  raw += c
})
process.stdin.on('end', () => {
  const spec = JSON.parse(raw) as AgentNodeSpec
  if (!spec.join) throw new Error('spec.join (k3sToken, tsAuthKey) is required')
  // The db-agent service is already on the node and stays: installing it again would touch the mounted disk.
  process.stdout.write(agentNodeUserData({ ...spec, dbAgent: false }))
})
