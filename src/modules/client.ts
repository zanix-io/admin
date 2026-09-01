/**
 * The client-safe surface of this package — role constants, Application names, the four
 * hub-facing thin HTTP clients (`TriggersHubClient`/`TemplatesHubClient`/`RegistryHubClient`/
 * `DlqHubClient`), and the light wire-shape types they return. Exposed as its own subpath
 * specifically so a consumer that never runs its own admin backend (a `@zanix/space` ops/dashboard
 * frontend calling a REMOTE `zanix-admin` hub over HTTP — e.g. `@zanix/console`) never resolves
 * this package's root barrel, which ALSO re-exports
 * `TriggersAdminRepository`/`TemplatesAdminRepository`/`TriggersAggregator`/`DlqAggregator` and
 * everything those pull in (`@zanix/datamaster`'s Mongo-backed persistence layer, Handlebars, ...)
 * — real weight this subpath's own consumer never needs, and enough to crash `zanix space dev`'s
 * own SSR bundling when pulled into that build.
 *
 * Nothing exported here is NEW — every symbol is the exact same binding the root barrel already
 * exports, just reachable without the heavy baggage. A future addition to the root barrel (a new
 * constant, a new hub-facing client) should be mirrored here too, the same way this package's own
 * `AggregatedTrigger` re-export already stays type-only to avoid pulling in
 * `triggers.aggregator.ts`'s own heavier runtime module.
 *
 * @module
 */
export {
  ADMIN_APPLICATION,
  ADMIN_DLQ_ROLE,
  ADMIN_HUB_APPLICATION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
} from 'utils/constants.ts'

export type { ServiceRegistryEntry } from 'typings/registry.ts'
export type { AggregatedTrigger } from './triggers/triggers.aggregator.ts'
export type { AggregatedDlqEntry } from './dlq/dlq.aggregator.ts'

export { RegistryHubClient } from './registry/registry-hub.client.ts'
export { TemplatesHubClient } from './templates/templates-hub.client.ts'
export { TriggersHubClient } from './triggers/triggers-hub.client.ts'
export { DlqHubClient } from './dlq/dlq-hub.client.ts'
