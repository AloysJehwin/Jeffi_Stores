// Local setup for the film recordings. Runs against the LOCAL database only (a copy of real store data).
// Usage: node setup.mjs <admin|mask|cleanup>
//   admin    creates the film admin: a throwaway administrator whose first sign-in enrols two-factor
//   mask     writes .local/mask-dict.json, the customer names and address lines the admin shots must hide
//   cleanup  deletes the film admin with the rows it leaves behind, and .local/ (the dictionary holds real names)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { FILM_ADMIN, LOCAL } from './lib.mjs'

const DB = process.env.FILMS_DATABASE_URL || 'postgresql://localhost:5432/jeffi_production_ready'
if (!/^postgres(ql)?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)(:\d+)?\//.test(DB)) throw new Error('setup.mjs only runs against a local database')
const sql = q => {
  try {
    return execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch (e) {
    console.error(String(e.stderr || e.message).trim())
    process.exit(1)
  }
}
const email = `'${FILM_ADMIN.replace(/'/g, "''")}'`
const filmAdmins = `(SELECT a.id FROM admins a JOIN users u ON u.id = a.user_id WHERE u.email = ${email})`

const cmd = process.argv[2]
if (cmd === 'admin') {
  if (Number(sql(`SELECT count(*) FROM ${filmAdmins} x`)) > 0) {
    console.log(`${FILM_ADMIN} already exists`)
  } else {
    // Scopes come from the oldest administrator, so the film admin sees every page.
    sql(`WITH existing AS (SELECT id FROM users WHERE email = ${email}),
      created AS (INSERT INTO users (email, first_name) SELECT ${email}, 'Film' WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id),
      u AS (SELECT id FROM existing UNION ALL SELECT id FROM created)
      INSERT INTO admins (user_id, role, scopes, mfa_enabled)
      SELECT u.id, 'administrator', (SELECT a.scopes FROM admins a WHERE a.role = 'administrator' AND a.user_id <> u.id ORDER BY a.created_at LIMIT 1), false FROM u`)
    fs.rmSync(path.join(LOCAL, 'admin.json'), { force: true })
    console.log(`created ${FILM_ADMIN}; its first sign-in enrols two-factor`)
  }
} else if (cmd === 'mask') {
  const json = sql(`
    WITH names AS (
      SELECT trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) n FROM users
      UNION SELECT first_name FROM users UNION SELECT last_name FROM users
      UNION SELECT full_name FROM addresses UNION SELECT split_part(full_name, ' ', 1) FROM addresses
      UNION SELECT customer_name FROM orders UNION SELECT split_part(customer_name, ' ', 1) FROM orders
      UNION SELECT shipping_address_snapshot->>'full_name' FROM orders UNION SELECT billing_address_snapshot->>'full_name' FROM orders
      UNION SELECT split_part(shipping_address_snapshot->>'full_name', ' ', 1) FROM orders
    ), addr AS (
      SELECT address_line1 a FROM addresses UNION SELECT address_line2 FROM addresses
      UNION SELECT shipping_address_snapshot->>'address_line1' FROM orders UNION SELECT shipping_address_snapshot->>'address_line2' FROM orders
      UNION SELECT shipping_address_snapshot->>'landmark' FROM orders
      UNION SELECT billing_address_snapshot->>'address_line1' FROM orders UNION SELECT billing_address_snapshot->>'address_line2' FROM orders
    )
    SELECT json_build_object(
      'names', (SELECT json_agg(DISTINCT trim(n)) FROM names WHERE length(trim(coalesce(n, ''))) >= 4),
      'addresses', (SELECT json_agg(DISTINCT trim(a)) FROM addr WHERE length(trim(coalesce(a, ''))) >= 8)
    )`)
  fs.mkdirSync(LOCAL, { recursive: true })
  fs.writeFileSync(path.join(LOCAL, 'mask-dict.json'), json)
  const d = JSON.parse(json)
  console.log(`mask dictionary: ${d.names?.length ?? 0} names, ${d.addresses?.length ?? 0} address lines`)
} else if (cmd === 'cleanup') {
  // editor_sessions has no foreign key to admins, and draft locks and audit entries would only lose their admin.
  sql(`BEGIN;
    DELETE FROM editor_sessions WHERE admin_id IN ${filmAdmins};
    DELETE FROM draft_locks WHERE owner_admin_id IN ${filmAdmins} OR started_by_admin_id IN ${filmAdmins};
    DELETE FROM admin_audit_log WHERE admin_id IN ${filmAdmins};
    DELETE FROM users WHERE email = ${email};
    COMMIT;`)
  fs.rmSync(LOCAL, { recursive: true, force: true })
  console.log(`removed ${FILM_ADMIN} and .local/ (admins left: ${sql(`SELECT count(*) FROM ${filmAdmins} x`)})`)
} else {
  console.log('usage: node setup.mjs <admin|mask|cleanup>')
  process.exit(1)
}
