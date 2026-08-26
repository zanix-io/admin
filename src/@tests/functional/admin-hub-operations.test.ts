import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { activateApps, getLocalOperation } from '@zanix/app/runtime'
import { TemplatesAdminService } from '@zanix/notifications/templates-api'
import type { ZanixTemplateAttrs } from '@zanix/notifications/templates-types'
import { defineAdminHubApp, getAdminHubSubApps } from 'modules/admin-hub-app.ts'
import type { TriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'
import { setTriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'
import type { DlqAggregator } from 'modules/dlq/dlq.aggregator.ts'
import { setDlqAggregator } from 'modules/dlq/dlq.aggregator.ts'
import {
  ADMIN_HUB_DLQ_APPLICATION,
  ADMIN_HUB_TEMPLATES_APPLICATION,
  ADMIN_HUB_TRIGGERS_APPLICATION,
} from 'utils/constants.ts'

// `triggers: false, templates: false, dlq: false` skips all three REST controllers entirely (see
// `start-no-routes.test.ts`'s own comment for the same one-shot-registration constraint this
// suite already documents) — this test is about `operations`, not the REST surface, and must never
// collide with whatever those routes' own dedicated test files already registered elsewhere in the
// same suite. Since `getAdminHubSubApps()` now gates its own sub-apps by the SAME
// `triggers`/`templates`/`dlq` options `defineAdminHubApp` uses (see that function's own doc), this
// call deliberately passes it NO options (defaulting to all-enabled) rather than reusing the
// REST-disabling ones passed to `defineAdminHubApp` above — two independent calls, each with its
// own options, is exactly what keeps this file able to exercise every operation without ever
// standing up a real REST route.
stub(console, 'info')
stub(console, 'warn')

await activateApps([
  defineAdminHubApp({ triggers: false, templates: false, dlq: false }),
  ...getAdminHubSubApps(),
])

// Triggers'/Templates'/DLQ's `operations` now live on their own physically-separate sub-apps
// (`ADMIN_HUB_TRIGGERS_APPLICATION`/`ADMIN_HUB_TEMPLATES_APPLICATION`/`ADMIN_HUB_DLQ_APPLICATION`),
// not on `defineAdminHubApp` itself — see `admin-hub-app.ts`'s own doc for why.
const TRIGGERS_OPERATIONS = new Set([
  'listTriggers',
  'getTrigger',
  'createTrigger',
  'updateTrigger',
  'removeTrigger',
])
const DLQ_OPERATIONS = new Set([
  'listDlqEntries',
  'getDlqEntry',
  'pushDlqEntry',
  'requeueDlqEntry',
  'discardDlqEntry',
  'removeDlqEntry',
])

function getOperation(name: string) {
  const application = TRIGGERS_OPERATIONS.has(name)
    ? ADMIN_HUB_TRIGGERS_APPLICATION
    : DLQ_OPERATIONS.has(name)
    ? ADMIN_HUB_DLQ_APPLICATION
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

// deno-lint-ignore no-explicit-any
function fakeDlqAggregator(overrides: Record<string, any>) {
  const fake = overrides as unknown as DlqAggregator
  setDlqAggregator(fake)
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

Deno.test(
  'admin-hub-dlq app: listDlqEntries forwards to the installed DlqAggregator',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      list: (...args: unknown[]) => (calls.push(args), Promise.resolve(['a'])),
    })

    const { handler, ctx } = getOperation('listDlqEntries')
    const result = await handler(undefined, ctx)
    assertEquals(result, ['a'])
    assertEquals(calls, [[]])
  },
)

Deno.test(
  'admin-hub-dlq app: getDlqEntry forwards {serviceId, id} to the aggregator, real HTTP fan-out',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      get: (...args: unknown[]) => (calls.push(args), Promise.resolve({ _id: 'e1' })),
    })

    const { handler, ctx } = getOperation('getDlqEntry')
    const result = await handler({ serviceId: 'billing', id: 'e1' }, ctx)
    assertEquals(result, { _id: 'e1' })
    assertEquals(calls, [['billing', 'e1']])
  },
)

Deno.test(
  'admin-hub-dlq app: pushDlqEntry forwards {serviceId, ...input} to the aggregator',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      push: (...args: unknown[]) => (calls.push(args), Promise.resolve({ _id: 'e1' })),
    })

    const { handler, ctx } = getOperation('pushDlqEntry')
    const result = await handler(
      {
        serviceId: 'billing',
        processType: 'payment.process',
        origin: 'billing',
        payload: { orderId: 'o-1' },
        error: { name: 'Error', message: 'boom' },
      },
      ctx,
    )
    assertEquals(result, { _id: 'e1' })
    assertEquals(calls, [[
      'billing',
      {
        processType: 'payment.process',
        origin: 'billing',
        payload: { orderId: 'o-1' },
        error: { name: 'Error', message: 'boom' },
      },
    ]])
  },
)

Deno.test(
  'admin-hub-dlq app: requeueDlqEntry forwards {serviceId, id, ...options} to the aggregator',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      requeue: (...args: unknown[]) => (calls.push(args), Promise.resolve({ _id: 'e1' })),
    })

    const { handler, ctx } = getOperation('requeueDlqEntry')
    const result = await handler(
      { serviceId: 'billing', id: 'e1', resetAttempts: true },
      ctx,
    )
    assertEquals(result, { _id: 'e1' })
    assertEquals(calls, [['billing', 'e1', { resetAttempts: true }]])
  },
)

Deno.test(
  'admin-hub-dlq app: discardDlqEntry forwards {serviceId, id, ...options} to the aggregator',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      discard: (...args: unknown[]) => (calls.push(args), Promise.resolve({ _id: 'e1' })),
    })

    const { handler, ctx } = getOperation('discardDlqEntry')
    const result = await handler({ serviceId: 'billing', id: 'e1', reason: 'stale' }, ctx)
    assertEquals(result, { _id: 'e1' })
    assertEquals(calls, [['billing', 'e1', { reason: 'stale' }]])
  },
)

Deno.test(
  'admin-hub-dlq app: removeDlqEntry forwards {serviceId, id}, reports deleted',
  async () => {
    const calls: unknown[][] = []
    fakeDlqAggregator({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    })

    const { handler, ctx } = getOperation('removeDlqEntry')
    const result = await handler({ serviceId: 'billing', id: 'e1' }, ctx)
    assertEquals(result, { deleted: 'e1' })
    assertEquals(calls, [['billing', 'e1']])
  },
)

Deno.test('admin-hub sub-apps: mutating operations never carry `mcp` — only list/get do', () => {
  for (
    const name of [
      'createTrigger',
      'updateTrigger',
      'removeTrigger',
      'createTemplate',
      'pushDlqEntry',
      'requeueDlqEntry',
      'discardDlqEntry',
      'removeDlqEntry',
    ]
  ) {
    assertEquals(
      getOperation(name).mcp,
      null,
      `${name} must not be exposed via mcp`,
    )
  }
  for (
    const name of [
      'listTriggers',
      'getTrigger',
      'listTemplates',
      'getTemplate',
      'listDlqEntries',
      'getDlqEntry',
    ]
  ) {
    assert(getOperation(name).mcp, `${name} must be exposed via mcp`)
  }
})

Deno.test(
  "getAdminHubSubApps(options): composes a resource's sub-app if and only if that same option " +
    "isn't false — mirrors defineAdminHubApp's own REST-controller gating exactly",
  () => {
    // Pure calls — `getAdminHubSubApps()` never touches `ProgramModule`/DI, just builds plain
    // `ZanixAppDefinition`s, so none of this needs `activateApps` and can't affect (or be affected
    // by) the module-level activation this file already did above.
    assertEquals(
      getAdminHubSubApps().map((app) => app.definition.name),
      [ADMIN_HUB_TRIGGERS_APPLICATION, ADMIN_HUB_TEMPLATES_APPLICATION, ADMIN_HUB_DLQ_APPLICATION],
      "no options (or every option omitted): every sub-app composed, matching defineAdminHubApp()'s own all-enabled default",
    )

    assertEquals(
      getAdminHubSubApps({ dlq: false }).map((app) => app.definition.name),
      [ADMIN_HUB_TRIGGERS_APPLICATION, ADMIN_HUB_TEMPLATES_APPLICATION],
      'dlq: false alone: only the dlq sub-app is skipped',
    )

    assertEquals(
      getAdminHubSubApps({ triggers: false, templates: false }).map((app) => app.definition.name),
      [ADMIN_HUB_DLQ_APPLICATION],
      'triggers/templates both false: only the dlq sub-app remains',
    )

    assertEquals(
      getAdminHubSubApps({ triggers: false, templates: false, dlq: false }),
      [],
      'every option false: no sub-app composed at all',
    )
  },
)
