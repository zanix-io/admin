import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, DEFAULT_APPLICATION, webServerManager } from '@zanix/server'
import { TEMPLATES_BACKEND_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { DLQ_MODEL_ENV } from '@zanix/datamaster/dlq'
import {
  ADMIN_DLQ_APPLICATION_ENV,
  ADMIN_TEMPLATES_APPLICATION_ENV,
  ADMIN_TRIGGERS_APPLICATION_ENV,
  defineAdminMetadata,
} from '../../../mod.ts'

// Covers the `Deno.env.get(ADMIN_TRIGGERS_APPLICATION_ENV) || ADMIN_APPLICATION`,
// `Deno.env.get(ADMIN_TEMPLATES_APPLICATION_ENV) || ADMIN_APPLICATION`, and
// `Deno.env.get(ADMIN_DLQ_APPLICATION_ENV) || ADMIN_APPLICATION` fallbacks' left-hand (override
// present) branch — every other file in this suite only ever exercises the right-hand (unset,
// default `ADMIN_APPLICATION`) side. See `admin-metadata-defaults.test.ts`'s own comment for why
// this needs its own file/process.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'defineAdminMetadata() ADMIN_TRIGGERS_APPLICATION/ADMIN_TEMPLATES_APPLICATION/ADMIN_DLQ_APPLICATION move all three routes off ADMIN_APPLICATION',
  fn: async () => {
    Deno.env.set(ADMIN_TRIGGERS_APPLICATION_ENV, DEFAULT_APPLICATION)
    Deno.env.set(ADMIN_TEMPLATES_APPLICATION_ENV, DEFAULT_APPLICATION)
    Deno.env.set(ADMIN_DLQ_APPLICATION_ENV, DEFAULT_APPLICATION)
    // `TEMPLATES_BACKEND` is the explicit mode selector `@zanix/notifications` requires — setting
    // `TEMPLATES_MODEL_ENV` alone has no effect (it's simply never read) since that package's own
    // breaking change replaced the old "infer the mode from whichever var is set" design.
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-test')
    Deno.env.set(DLQ_MODEL_ENV, 'zanix-dlq-test')
    await defineAdminMetadata()
    Deno.env.delete(ADMIN_TRIGGERS_APPLICATION_ENV)
    Deno.env.delete(ADMIN_TEMPLATES_APPLICATION_ENV)
    Deno.env.delete(ADMIN_DLQ_APPLICATION_ENV)
    Deno.env.delete(TEMPLATES_BACKEND_ENV)
    Deno.env.delete(TEMPLATES_MODEL_ENV)
    Deno.env.delete(DLQ_MODEL_ENV)

    const [serverId] = await bootstrapServers({
      rest: { application: DEFAULT_APPLICATION },
    })
    assert(serverId, 'the public REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    // Default `globalPrefix` for a public (unanchored) REST server is `api`.
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/api`

    const triggers = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(triggers.status, 401)
    await triggers.body?.cancel()

    const templates = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(templates.status, 401)
    await templates.body?.cancel()

    const dlq = await fetch(`${baseUrl}/admin/dlq/list`)
    assertEquals(dlq.status, 401)
    await dlq.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
