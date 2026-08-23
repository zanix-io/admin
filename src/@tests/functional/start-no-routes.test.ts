import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Its own file: `triggers: false, templates: false, dlq: false` must be the very first thing that
// runs in this process — importing `triggers.handler.ts`/`templates.handler.ts`/`dlq.handler.ts`
// anywhere else (as every other functional test does) registers their routes for good, which would
// make this assertion moot. See `start.test.ts`'s own comment for the same one-shot-registration
// constraint.

const warn = stub(console, 'warn')
stub(console, 'info')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start({ triggers: false, templates: false, dlq: false }) skips all three REST ' +
    'controllers AND all three hub sub-apps, but still starts the admin server for /registry ' +
    "alone — no `false` opt-out exists for it (see createRegistryController's own doc)",
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'start-no-routes-test')

    const servers = await ZanixAdminHub.start({
      triggers: false,
      templates: false,
      dlq: false,
    })

    // `defineAdminHubApp` itself declares no `operations` anymore (see its own doc) — Triggers'/
    // Templates'/DLQ's `operations` live on their own physically-separate sub-apps
    // (`getAdminHubSubApps`), gated by the SAME `triggers`/`templates`/`dlq` options as their REST
    // counterparts (see that function's own doc) — `start.ts`'s own `startSequence` passes this
    // call's exact `{ triggers, templates, dlq }` to both `defineAdminHubApp` and
    // `getAdminHubSubApps`, so all three REST options being `false` means all three sub-apps are
    // skipped too, not just their REST controllers. Unlike before `GET /registry` existed, this is
    // NOT an empty boot anymore — `ADMIN_HUB_APPLICATION`'s own server still starts, since
    // `createRegistryController` is composed unconditionally regardless of `triggers`/`templates`/
    // `dlq` — so `start()`'s own top-level `!servers.length` warning never fires here.
    assertEquals(
      servers.length,
      1,
      'the admin server should still start, serving only /registry',
    )
    assertEquals(warn.calls.length, 0, 'a real route exists, so the empty-boot warning is skipped')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the admin server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${servers[0]}`

    const registry = await fetch(`${baseUrl}/registry/list`)
    assertEquals(registry.status, 401, '/registry stays behind auth even with everything else off')
    await registry.body?.cancel()

    // The three disabled controllers/sub-apps genuinely never registered — 404, not just 401.
    const triggers = await fetch(`${baseUrl}/triggers/list`)
    assertEquals(triggers.status, 404)
    await triggers.body?.cancel()

    Deno.env.delete('ADMIN_HUB_SERVER_ID')
    await ZanixAdminHub.stop()
  },
})
