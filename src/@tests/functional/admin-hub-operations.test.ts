import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { activateApps, getLocalOperation } from '@zanix/app/runtime'
import { TemplatesAdminService, type ZanixTemplateAttrs } from '@zanix/notifications'
import { defineAdminHubApp, getAdminHubSubApps } from 'modules/admin-hub-app.ts'
import type { TriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'
import { setTriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'
import { ADMIN_HUB_TEMPLATES_APPLICATION, ADMIN_HUB_TRIGGERS_APPLICATION } from 'utils/constants.ts'

// `triggers: false, templates: false` skips both REST controllers entirely (see
// `start-no-routes.test.ts`'s own comment for the same one-shot-registration constraint this
// suite already documents) — this test is about `operations`, which are ALWAYS registered
// regardless of those two options (see `defineAdminHubApp`'s own doc), so there is nothing to gain
// from also standing up the REST surface here, and real risk of colliding with whatever those
// routes' own dedicated test files already registered elsewhere in the same suite.
stub(console, 'info')
stub(console, 'warn')

await activateApps([
  defineAdminHubApp({ triggers: false, templates: false }),
  ...getAdminHubSubApps(),
])

// Triggers'/Templates' `operations` now live on their own physically-separate sub-apps
// (`ADMIN_HUB_TRIGGERS_APPLICATION`/`ADMIN_HUB_TEMPLATES_APPLICATION`), not on `defineAdminHubApp`
// itself — see `admin-hub-app.ts`'s own doc for why.
const TRIGGERS_OPERATIONS = new Set([
  'listTriggers',
  'getTrigger',
  'createTrigger',
  'updateTrigger',
  'removeTrigger',
])

function getOperation(name: string) {
  const application = TRIGGERS_OPERATIONS.has(name)
    ? ADMIN_HUB_TRIGGERS_APPLICATION
    : ADMIN_HUB_TEMPLATES_APPLICATION
  const found = getLocalOperation(application, name)
  assert(
    found,
    `operation "${name}" should be registered under "${application}"`,
  )
  return found
}

// Same technique `triggers.handler.test.ts` already uses for the exact same singleton.
// deno-lint-ignore no-explicit-any
function fakeAggregator(overrides: Record<string, any>) {
  const fake = overrides as unknown as TriggersAggregator
  setTriggersAggregator(fake)
  return fake
}

Deno.test('admin-hub-triggers app: listTriggers forwards to the installed aggregator', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    list: (...args: unknown[]) => (calls.push(args), Promise.resolve(['a'])),
  })

  const { handler, ctx } = getOperation('listTriggers')
  const result = await handler(undefined, ctx)
  assertEquals(result, ['a'])
  assertEquals(calls, [[]])
})

Deno.test(
  'admin-hub-triggers app: getTrigger forwards {serviceId, model} to the aggregator, real HTTP fan-out',
  async () => {
    const calls: unknown[][] = []
    fakeAggregator({
      get: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ model: 'Invoice' })),
    })

    const { handler, ctx } = getOperation('getTrigger')
    const result = await handler(
      { serviceId: 'billing', model: 'Invoice' },
      ctx,
    )
    assertEquals(result, { model: 'Invoice' })
    assertEquals(calls, [['billing', 'Invoice']])
  },
)

Deno.test(
  'admin-hub-triggers app: createTrigger forwards {serviceId, model, active, triggers} to the aggregator',
  async () => {
    const calls: unknown[][] = []
    fakeAggregator({
      create: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ model: 'Invoice' })),
    })

    const { handler, ctx } = getOperation('createTrigger')
    const result = await handler(
      { serviceId: 'billing', model: 'Invoice', active: true, triggers: { pre: {} } },
      ctx,
    )
    assertEquals(result, { model: 'Invoice' })
    assertEquals(calls, [[
      'billing',
      { model: 'Invoice', active: true, triggers: { pre: {} } },
    ]])
  },
)

Deno.test(
  'admin-hub-triggers app: updateTrigger forwards {serviceId, model, active, triggers} to the aggregator',
  async () => {
    const calls: unknown[][] = []
    fakeAggregator({
      update: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ model: 'Invoice', active: false })),
    })

    const { handler, ctx } = getOperation('updateTrigger')
    const result = await handler(
      { serviceId: 'billing', model: 'Invoice', active: false },
      ctx,
    )
    assertEquals(result, { model: 'Invoice', active: false })
    assertEquals(calls, [['billing', 'Invoice', { active: false, triggers: undefined }]])
  },
)

Deno.test(
  'admin-hub-triggers app: removeTrigger forwards {serviceId, model}, reports deleted',
  async () => {
    const calls: unknown[][] = []
    fakeAggregator({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    })

    const { handler, ctx } = getOperation('removeTrigger')
    const result = await handler({ serviceId: 'billing', model: 'Invoice' }, ctx)
    assertEquals(result, { deleted: 'Invoice' })
    assertEquals(calls, [['billing', 'Invoice']])
  },
)

Deno.test(
  'admin-hub-templates app: listTemplates forwards to TemplatesAdminService.list()',
  async () => {
    const listStub = stub(
      TemplatesAdminService.prototype,
      'list',
      () => Promise.resolve(['t'] as unknown as ZanixTemplateAttrs[]),
    )
    try {
      const { handler, ctx } = getOperation('listTemplates')
      const result = await handler(undefined, ctx)
      assertEquals(result, ['t'])
    } finally {
      listStub.restore()
    }
  },
)

Deno.test('admin-hub sub-apps: mutating operations never carry `mcp` — only list/get do', () => {
  for (
    const name of [
      'createTrigger',
      'updateTrigger',
      'removeTrigger',
      'createTemplate',
    ]
  ) {
    assertEquals(
      getOperation(name).mcp,
      null,
      `${name} must not be exposed via mcp`,
    )
  }
  for (
    const name of ['listTriggers', 'getTrigger', 'listTemplates', 'getTemplate']
  ) {
    assert(getOperation(name).mcp, `${name} must be exposed via mcp`)
  }
})
