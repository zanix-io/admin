/**
 * Grants access to every admin API this package owns (`/admin/triggers`, `/admin/templates`, and
 * any `@zanix/core`-based service exposing the same admin protocol). Combine with
 * {@link ADMIN_TRIGGERS_ROLE}/{@link ADMIN_TEMPLATES_ROLE} when a caller should only reach one of
 * the two APIs.
 *
 * ```ts
 * await authProvider.session.generateTokens(adminUser, { permissions: [ADMIN_ROLE] })
 * ```
 */
export const ADMIN_ROLE = 'zanix:admin'

/** Grants access to the triggers admin API (`/admin/triggers`) only. */
export const ADMIN_TRIGGERS_ROLE = 'zanix:admin:triggers'

/** Grants access to the templates admin API (`/admin/templates`) only. */
export const ADMIN_TEMPLATES_ROLE = 'zanix:admin:templates'

export { ADMIN_PROTOCOL_SUPPORTED_VERSIONS, ADMIN_PROTOCOL_VERSION } from './protocol/constants.ts'
