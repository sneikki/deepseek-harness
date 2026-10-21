import { join } from 'node:path'
import { Rolldown, type UserConfig } from 'tsdown'
import { staticLinked } from '../tsdown.client.ts'

const WORKER_SOURCE = '\0dsh-plain-text-worker-source'

/** Embed the Markdown plain-text Worker as text: it has no loader-module table to resolve imports from. */
const plainTextWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-plain-text-worker-source',
  resolveId(source) { return source === './plain-text-worker.ts?raw' ? WORKER_SOURCE : null },
  async load(id) {
    if (id !== WORKER_SOURCE) return null
    const worker = await Rolldown.rolldown({
      input: join(import.meta.dirname, 'src/markdown/plain-text-worker.ts'), platform: 'browser',
      transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    })
    try {
      const result = await worker.generate({ format: 'iife', minify: true })
      const chunk = result.output[0]
      if (chunk?.type !== 'chunk') throw new Error('Plain-text Worker did not emit a JavaScript chunk')
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
      return `export default ${JSON.stringify(chunk.code)};`
    } finally { await worker.close() }
  },
}]

const build = staticLinked(import.meta.dirname, ['lib/types/index.js'])

export default (options: Parameters<typeof build>[0]): UserConfig[] => build(options).map(config => ({
  ...config,
  plugins: [config.plugins, plainTextWorker],
}))
