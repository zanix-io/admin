import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// See `start.test.ts`'s own note: only one `ZanixAdminHub.start()` test per file.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdminHub.start() honors its own ADMIN_HUB_SERVER_ID for a stable id, distinct from @zanix/core's ADMIN_SERVER_ID",
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'custom-hub')

    try {
      const servers = await ZanixAdminHub.start()
      assertEquals(servers[0], 'custom-hub-rest')
      await ZanixAdminHub.stop()
    } finally {
      Deno.env.delete('ADMIN_HUB_SERVER_ID')
    }
  },
})
