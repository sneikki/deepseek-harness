/** Localized chrome of the rich tool bodies a ledger box draws, from the chat tool row's builders. @module */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  codeToolbarLabels, diffBlockLabels, readBlockLabels, searchBlockLabels,
} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CodeToolbarLabels, DiffBlockLabels, ReadBlockLabels, SearchBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Labels for the code, file-read, diff and search bodies, plus the code copy actions. */
export interface TrajectoryToolLabels {
  code: CodeToolbarLabels
  copy: string
  copied: string
  read: ReadBlockLabels
  diff: DiffBlockLabels
  search: SearchBlockLabels
}

/**
 * Build the rich-body labels from the conversation locale, so a ledger box and a chat row read the same words.
 * @param t - conversation-namespace translate function.
 * @returns the label set for every rich body.
 */
export function trajectoryToolLabels(t: TranslateNS<'conversation'>): TrajectoryToolLabels {
  return {
    code: codeToolbarLabels(t),
    copy: t('copy'),
    copied: t('copied'),
    read: readBlockLabels(t),
    diff: diffBlockLabels(t),
    search: searchBlockLabels(t),
  }
}
