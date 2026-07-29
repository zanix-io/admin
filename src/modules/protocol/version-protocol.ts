import type { VersionProtocolOptions } from '@zanix/server'

import { ADMIN_PROTOCOL_HEADER } from '@zanix/server'

import { ADMIN_PROTOCOL_SUPPORTED_VERSIONS, ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * The `versionProtocol` config every controller this package builds passes to `@Controller` —
 * `@zanix/server`'s generic, on-by-default protocol-version negotiation, configured with this
 * package's own already-shipped header name/version/supported-versions (see
 * {@link ADMIN_PROTOCOL_HEADER}) instead of `@zanix/server`'s generic default, for backward
 * compatibility with this package's existing wire contract.
 */
export const ADMIN_VERSION_PROTOCOL: VersionProtocolOptions = {
  header: ADMIN_PROTOCOL_HEADER,
  version: ADMIN_PROTOCOL_VERSION,
  supportedVersions: ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
}
