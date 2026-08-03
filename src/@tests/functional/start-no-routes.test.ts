import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// Its own file: `triggers: false, templates: false` must be the very first thing that runs in this
// process — importing `triggers.handler.ts`/`templates.handler.ts` anywhere else (as every other
// functional test does) registers their routes for good, which would make `servers.length` nonzero
// here too. See `start.test.ts`'s own comment for the same one-shot-registration constraint.

const warn = stub(console, 'warn')
stub(console, 'info')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'ZanixAdminHub.start({ triggers: false, templates: false }) starts no server and warns',
  fn: async () => {
    const servers = await ZanixAdminHub.start({ triggers: false, templates: false })

    assertEquals(servers, [])
    assertEquals(warn.calls.length, 1)
  },
})
