/** Localized chrome of the rich tool bodies, from the chat tool row's label builders. @module */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CodeToolbarLabels, DiffBlockLabels, ReadBlockLabels, SearchBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { codeToolbarLabels, diffBlockLabels, readBlockLabels, searchBlockLabels } from './primitive-labels.ts'

/** Labels for the code, file-read, diff and search bodies, plus the code copy actions. */
export interface ToolCardLabels {
  code: CodeToolbarLabels
  copy: string
  copied: string
  read: ReadBlockLabels
  diff: DiffBlockLabels
  search: SearchBlockLabels
}

/**
 * Build the rich-body labels from the conversation locale.
 * @param t - conversation-namespace translate function.
 * @returns the label set for every rich body.
 */
export function toolCardLabels(t: TranslateNS<'conversation'>): ToolCardLabels {
  return {
    code: codeToolbarLabels(t),
    copy: t('copy'),
    copied: t('copied'),
    read: readBlockLabels(t),
    diff: diffBlockLabels(t),
    search: searchBlockLabels(t),
  }
}
