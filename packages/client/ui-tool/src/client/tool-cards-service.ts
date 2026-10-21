/** Cordis service exposing the rich tool bodies and their labels to other client plugins. @module */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from './tool/models/tool-call-model.ts'
import { toolCardBody, type ToolCardBody } from './tool/models/tool-card-body.ts'
import { toolCardLabels, type ToolCardLabels } from './tool/models/tool-card-labels.ts'
// Type-only: the Host facts carry the account home used for `~` paths.
import type {} from '@deepseek-ai/dsh-api-remotes/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Rich tool bodies and their labels, the same ones the chat tool row draws. */
    toolCards: ToolCards
  }
}

/** The `ctx.toolCards` service: pure derivations bound to the Host account home. */
export class ToolCards extends Service {
  constructor(ctx: Context) {
    super(ctx, 'toolCards')
  }

  /**
   * The rich body of one tool call.
   * @param toolName - recorded tool name.
   * @param block - running or settled Tool block.
   * @param cwd - session workspace root, for relative read paths.
   * @returns the body, or undefined for the plain box.
   */
  cardBody(toolName: string, block: ToolCallBlock, cwd?: string): ToolCardBody | undefined {
    return toolCardBody(toolName, block, cwd, this.ctx.remote.$host.home)
  }

  /**
   * Labels of the rich bodies in the given conversation locale.
   * @param t - conversation-namespace translate function.
   * @returns the label set.
   */
  labels(t: TranslateNS<'conversation'>): ToolCardLabels {
    return toolCardLabels(t)
  }
}
