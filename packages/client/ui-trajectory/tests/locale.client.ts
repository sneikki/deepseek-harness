import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en, zh, type TrajectoryTranslate } from '../src/client/locales.ts'
import { toolCardLabels } from '@deepseek-ai/dsh-client-ui-tool/client'

function translator(dictionary: Record<string, string>): TrajectoryTranslate {
  return (key, params = {}) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : ''
    })
  }
}

/** Conversation-namespace stand-in for the shared tool-body labels: each key reads as its own text. */
export const conversationT: (key: string) => string = key => key

/** Rich tool-body labels in the stand-in conversation locale, as the view builds them. */
export const toolLabels = toolCardLabels(conversationT)

/** English trajectory translator for component and pure-layout tests. */
export const t = translator({ ...commonEn, ...en })

/** Chinese trajectory translator for real-view fixtures that open in Chinese. */
export const tZh = translator({ ...commonZh, ...zh })
