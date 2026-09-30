import type { ResolvedSlidevOptions, SlidevPluginOptions } from '@slidev/types'
import ServerRef from 'vite-plugin-vue-server-ref'
import { loadDrawings, writeDrawings } from '../integrations/drawings'
import { loadSnapshots, writeSnapshots } from '../integrations/snapshots'

export async function createServerRefPlugin(
  options: ResolvedSlidevOptions,
  pluginOptions: SlidevPluginOptions,
) {
  return ServerRef({
    debug: false, // process.env.NODE_ENV === 'development',
    state: {
      sync: false,
      nav: {
        page: 0,
        clicks: 0,
        timer: {
          status: 'stopped',
          slides: {},
          startedAt: 0,
          pausedAt: 0,
        },
      },
      drawings: await loadDrawings(options),
      snapshots: await loadSnapshots(options),
      screenShare: {
        // `id: ''` means nobody is sharing. We avoid `null` here because the
        // server-ref diff/apply treats `typeof null === 'object'` and crashes
        // when a `null` value transitions into an object.
        presenter: { id: '', offers: {} },
        viewers: {},
      },
      ...pluginOptions.serverRef?.state,
    },
    onChanged(key, data, patch, timestamp) {
      pluginOptions.serverRef?.onChanged?.(key, data, patch, timestamp)

      if (options.data.config.drawings.persist && key === 'drawings')
        writeDrawings(options, patch ?? data)

      if (key === 'snapshots')
        writeSnapshots(options, data)
    },
  })
}
