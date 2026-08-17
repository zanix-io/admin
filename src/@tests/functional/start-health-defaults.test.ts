import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Own file — same one-shot-registration constraint as `start.test.ts`.

stub(console, 'info')
stub(console, 'warn')

/**
 * `ZanixAdminHub.start()` funnels through `@zanix/app`'s `bootstrapAppServer`, the same primitive
 * `@zanix/core`'s embedded admin and named `apps` use — confirms it inherits `@zanix/server`'s new
 * `health` default (on) with zero code of its own, exactly as the health/readiness design doc's
 * own "todos los dueños" claim promises.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'ZanixAdminHub.start(): /health and /ready are registered by default',
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'start-health-defaults-test')

    const servers = await ZanixAdminHub.start()
    assert(servers.length > 0, 'an admin REST server should have been started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the started server should be listening')
    const base = `http://${info.addr.hostname}:${info.addr.port}`

    const health = await fetch(`${base}/health`)
    assertEquals(health.status, 200)
    assertEquals(await health.json(), { status: 'ok' })

    // Deliberately does NOT assert `/ready`'s own response shape (`shared`/`apps`/nested
    // `checks` breakdown, etc.) — that contract belongs to `@zanix/server`'s own
    // `buildReadinessHandler` and is pinned by ITS OWN test suite there. Re-asserting it here would
    // couple this package's regression test (whether `start()` forwards `health` at all) to an
    // upstream implementation detail it doesn't own — exactly the coupling that broke this test
    // the last time that shape changed. All this cares about: the endpoint exists, responds, and
    // reports a well-formed top-level `status`.
    const ready = await fetch(`${base}/ready`)
    assert(ready.status === 200 || ready.status === 503)
    const readyBody = await ready.json()
    assert(readyBody.status === 'ok' || readyBody.status === 'degraded')

    Deno.env.delete('ADMIN_HUB_SERVER_ID')
    await ZanixAdminHub.stop()
  },
})
