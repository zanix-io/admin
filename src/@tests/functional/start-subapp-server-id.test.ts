import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// See `start.test.ts`'s own note: only one `ZanixAdminHub.start()` test per file.
//
// A hub sub-app (e.g. `admin-hub-triggers`) resolves its OWN stable-id env var too, same
// `resolveApplicationServerId` convention `start-admin-server-id.test.ts` already covers for the
// hub Application itself — `ADMIN_HUB_TRIGGERS_SERVER_ID` here. Almost always unset in practice
// (see `start.ts`'s own comment), so every other test in this suite only ever exercises the
// unanchored fallback (`globalPrefix: definition.name`); this is the one place the anchored
// branch (`globalPrefix: undefined`, id-prefixed instead) gets exercised.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdminHub.start() honors a hub sub-app's own <NAME>_SERVER_ID for a stable, id-anchored id",
  fn: async () => {
    Deno.env.set('ADMIN_HUB_TRIGGERS_SERVER_ID', 'custom-triggers')

    try {
      const servers = await ZanixAdminHub.start()
      assert(
        servers.includes('custom-triggers-rest'),
        `expected an anchored 'custom-triggers-rest' server, got: ${JSON.stringify(servers)}`,
      )
      await ZanixAdminHub.stop()
    } finally {
      Deno.env.delete('ADMIN_HUB_TRIGGERS_SERVER_ID')
    }
  },
})
