import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// Its own file: `triggers: false, templates: false` must be the very first thing that runs in this
// process — importing `triggers.handler.ts`/`templates.handler.ts` anywhere else (as every other
// functional test does) registers their routes for good, which would make this assertion moot.
// See `start.test.ts`'s own comment for the same one-shot-registration constraint.

const warn = stub(console, 'warn')
stub(console, 'info')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'ZanixAdminHub.start({ triggers: false, templates: false }) skips both REST controllers, ' +
    "but still starts servers for each sub-app's operations dispatch route — never warns",
  fn: async () => {
    const servers = await ZanixAdminHub.start({
      triggers: false,
      templates: false,
    })

    // `defineAdminHubApp` itself declares no `operations` anymore (see its own doc) — Triggers'/
    // Templates' `operations` (independent of the REST `triggers`/`templates` options) now live on
    // their own physically-separate sub-apps (`getAdminHubSubApps`), each always activated
    // alongside `defineAdminHubApp` and each bootstrapped with its own `bootstrapAppServer` call
    // (`start.ts`'s own `startSequence`) — so `registerRemoteDispatchRoutes` registers a real
    // `/__zanix-ops/<sub-app-name>/...` controller for EACH of them regardless, and each gets its
    // own server (sharing one port, per `bootstrapAppServer`'s own address-reuse behavior) even
    // with both REST controllers skipped — so the "no server was started" warning never fires.
    assertEquals(
      servers.length,
      2,
      'one server per hub sub-app (admin-hub-triggers, admin-hub-templates) should start to ' +
        "serve each one's own operations dispatch route",
    )
    assertEquals(warn.calls.length, 0)
  },
})
