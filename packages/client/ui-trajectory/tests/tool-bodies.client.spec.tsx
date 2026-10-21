// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import {
  CodeBlock, DiffBlock, ReadBlock, SearchBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { TrajectoryCard } from '../src/client/TrajectoryCard.tsx'
import type { TrajectoryCellProps, TrajectoryToolBody } from '../src/client/trajectory-record.ts'
import { deriveTrajectoryLayout as deriveTrajectoryLayoutWithLocale } from '../src/client/layout.ts'
import { conversationT, t } from './locale.client.ts'
import { toolCardBody, toolCardLabels } from '@deepseek-ai/dsh-client-ui-tool/client'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...actual,
    CodeBlock: vi.fn(() => null),
    ReadBlock: vi.fn(() => null),
    DiffBlock: vi.fn(() => null),
    SearchBlock: vi.fn(() => null),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const labels = toolCardLabels(conversationT)
/** The rich-body reader the view hands the layout, bound to a workspace root. */
const cards = (toolName: string, block: Parameters<typeof toolCardBody>[1]) => toolCardBody(toolName, block, '/w')

function toolCell(overrides: Partial<TrajectoryCellProps>): TrajectoryCellProps {
  return { index: 1, kind: 'tool', text: '', timeSeconds: 1, toolName: 'bash', ...overrides }
}

function renderCard(cell: TrajectoryCellProps, args: string | undefined, resultText: string | undefined) {
  return render(
    <TrajectoryCard
      cell={cell}
      content={{
        displayText: cell.toolName ?? '',
        resultText,
        callsBadge: undefined,
        toolCallText: { name: cell.toolName ?? '', program: false, ...(args === undefined ? {} : { args }) },
      }}
      badge={cell.toolName ?? ''}
      badgeTitle={cell.toolName ?? ''}
      expanded={false}
      onToggle={() => {}}
      t={t}
      toolLabels={labels}
    />,
  )
}

/** Props of the most recent call of a mocked primitive. */
function lastProps(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = mock.mock.calls.at(-1)
  expect(call).toBeDefined()
  return (call?.[0] ?? {}) as Record<string, unknown>
}

describe('rich tool bodies in the ledger box', () => {
  it('draws a bash command as bash-highlighted INPUT', () => {
    renderCard(
      toolCell({ toolName: 'bash', toolBody: { kind: 'bash', command: 'ls -la' } }),
      'ls -la', 'a.txt',
    )
    expect(lastProps(vi.mocked(CodeBlock))).toMatchObject({ code: 'ls -la', lang: 'bash' })
  })

  it('draws a read result through ReadBlock with the file language and no wrapper text', () => {
    const lines = [{ number: 1, text: 'const a = 1' }, { number: 2, text: 'export { a }' }]
    renderCard(
      toolCell({
        toolName: 'read',
        toolBody: { kind: 'read', label: 'src/a.ts', model: { label: 'src/a.ts', lines, totalLines: 2, lang: 'typescript' } },
      }),
      '{"file_path":"src/a.ts"}', '<path>src/a.ts</path>\n<type>file</type>\n<content>...',
    )
    expect(lastProps(vi.mocked(ReadBlock))).toMatchObject({ lang: 'typescript', lines, totalLines: 2, label: 'src/a.ts' })
    expect(screen.queryByText('<path>src/a.ts</path>', { exact: false })).toBeNull()
  })

  it('draws an edit as a DiffBlock in the OUTPUT section', () => {
    const diffs = [{ path: 'src/a.ts', oldText: 'const a = 1', newText: 'const a = 2' }]
    renderCard(
      toolCell({ toolName: 'edit', toolBody: { kind: 'diff', label: 'src/a.ts', model: { card: { diffs } } } }),
      '{"file_path":"src/a.ts"}', 'Edited src/a.ts',
    )
    expect(lastProps(vi.mocked(DiffBlock))).toMatchObject({ diffs })
  })

  it('draws grep matches through SearchBlock', () => {
    renderCard(
      toolCell({
        toolName: 'grep',
        toolBody: {
          kind: 'search',
          label: 'foo',
          model: { card: { kind: 'matches', files: [], total: 0, truncated: false }, recovery: 'full output: /w/out.txt' },
        } as TrajectoryToolBody,
      }),
      '{"pattern":"foo"}', 'a.ts:1: foo',
    )
    expect(lastProps(vi.mocked(SearchBlock))).toMatchObject({ kind: 'matches' })
    expect(screen.getByText('full output: /w/out.txt')).toBeTruthy()
  })

  it('draws a run_code program source as CodeBlock in its program language', () => {
    renderCard(
      toolCell({
        toolName: 'run_code',
        inputDetail: JSON.stringify({ code: 'print(1)', description: 'one' }),
      }),
      'one', 'ok',
    )
    expect(lastProps(vi.mocked(CodeBlock))).toMatchObject({ code: 'print(1)', lang: 'typescript' })
  })

  it('keeps plain text for a tool without a rich body', () => {
    renderCard(toolCell({ toolName: 'web_fetch' }), 'https://x.test', 'page text')
    expect(vi.mocked(CodeBlock)).not.toHaveBeenCalled()
    expect(vi.mocked(ReadBlock)).not.toHaveBeenCalled()
    expect(screen.getByText('page text')).toBeTruthy()
  })
})

describe('tool cell body derivation', () => {
  const settled = (callId: string, name: string, argsRaw: string, meta: unknown, text: string) => [
    { kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [{ kind: 'tool-call', callId, name, argsRaw }] },
    {
      kind: 'tool-result', seq: 3, time: 2_500, callId, name, args: PartialArguments.fromText(argsRaw),
      call: { name, argsRaw }, callTime: 2_100, content: [{ type: 'text', text }], meta, isError: false,
    },
  ]
  it('gives an applied edit its diff and a grep its matches', () => {
    const edit = settled(
      'e1', 'edit', '{"file_path":"/w/a.ts","old_string":"const a = 1","new_string":"const a = 2"}',
      { diffs: [{ path: '/w/a.ts', oldText: 'const a = 1', newText: 'const a = 2' }] }, 'Edited /w/a.ts',
    )
    const grep = settled(
      'g1', 'grep', '{"pattern":"foo"}',
      { shape: 'matches', files: [{ path: '/w/a.ts', matches: [{ lineNumber: 1, line: 'foo' }] }], total: 1, truncated: false },
      'a.ts:1: foo',
    )
    const cells = deriveTrajectoryLayoutWithLocale({
      nodes: [{ kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }], source: null }, ...edit, ...grep] as never,
      partial: null,
      runningCalls: [],
      cards,
    }, t).flatMap(turn => turn.groups.flatMap(group => group.cells)).filter(cell => cell.kind === 'tool')
    expect(cells.find(cell => cell.toolName === 'edit')?.toolBody?.kind).toBe('diff')
    expect(cells.find(cell => cell.toolName === 'grep')?.toolBody?.kind).toBe('search')
  })

  it('highlights a shell call without a description (persistent shell) too', () => {
    const bash = settled('p1', 'bash', '{"command":"ls"}', undefined, 'a.txt')
    const cells = deriveTrajectoryLayoutWithLocale({
      nodes: [{ kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }], source: null }, ...bash] as never,
      partial: null,
      runningCalls: [],
      cards,
    }, t).flatMap(turn => turn.groups.flatMap(group => group.cells)).filter(cell => cell.kind === 'tool')
    expect(cells[0]?.toolBody).toEqual({ kind: 'bash', command: 'ls' })
  })
  const nodes = [
    { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }], source: null },
    {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
      blocks: [
        { kind: 'tool-call', callId: 'b1', name: 'bash', argsRaw: '{"command":"ls -la","description":"list files"}' },
        { kind: 'tool-call', callId: 'r1', name: 'read', argsRaw: '{"file_path":"/w/a.ts"}' },
      ],
    },
    {
      kind: 'tool-result', seq: 3, time: 2_500, callId: 'b1', name: 'bash',
      args: PartialArguments.fromText('{"command":"ls -la","description":"list files"}'),
      call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"list files"}' }, callTime: 2_100,
      content: [{ type: 'text', text: 'a.txt' }], isError: false,
    },
    {
      kind: 'tool-result', seq: 4, time: 2_600, callId: 'r1', name: 'read',
      args: PartialArguments.fromText('{"file_path":"/w/a.ts"}'),
      call: { name: 'read', argsRaw: '{"file_path":"/w/a.ts"}' }, callTime: 2_200,
      content: [{
        type: 'text',
        text: '<path>/w/a.ts</path>\n<type>file</type>\n<content>\n1: const a = 1\n\n(End of file - total 1 lines)\n</content>',
      }],
      meta: { path: '/w/a.ts', offset: 1, lines: [{ number: 1, text: 'const a = 1' }], totalLines: 1, lang: 'typescript' },
      isError: false,
    },
  ] as Parameters<typeof deriveTrajectoryLayoutWithLocale>[0]['nodes']

  it('gives the bash call its command and the read call its file view', () => {
    const turns = deriveTrajectoryLayoutWithLocale({ nodes, partial: null, runningCalls: [], cards }, t)
    const tools = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
      .filter(cell => cell.kind === 'tool')
    expect(tools.find(cell => cell.toolName === 'bash')?.toolBody).toEqual({ kind: 'bash', command: 'ls -la' })
    const read = tools.find(cell => cell.toolName === 'read')?.toolBody
    expect(read?.kind).toBe('read')
    expect(read?.kind === 'read' ? read.model.lang : undefined).toBe('typescript')
    expect(read?.kind === 'read' ? read.model.label : undefined).toBe('a.ts')
  })
})

describe('header subject and standalone bodies', () => {
  it('names the file in the header and puts the diff in the INPUT slot, without the success line', () => {
    const diffs = [{ path: 'src/a.ts', oldText: 'const a = 1', newText: 'const a = 2' }]
    const { container } = renderCard(
      toolCell({ toolName: 'edit', toolBody: { kind: 'diff', label: 'src/a.ts', model: { card: { diffs } } } }),
      '{"file_path":"src/a.ts"}', 'Edited src/a.ts',
    )
    expect(container.querySelector('span[title="src/a.ts"]')).not.toBeNull()
    expect(container.querySelector('[data-section="input"]')).not.toBeNull()
    expect(container.querySelector('[data-section="output"]')).toBeNull()
    expect(lastProps(vi.mocked(DiffBlock))).toMatchObject({ diffs })
  })

  it('drops the arguments of a file read, its path is the header subject', () => {
    const lines = [{ number: 1, text: 'const a = 1' }]
    const { container } = renderCard(
      toolCell({
        toolName: 'read',
        toolBody: { kind: 'read', label: 'src/a.ts', model: { label: 'src/a.ts', lines, totalLines: 1, lang: 'typescript' } },
      }),
      '{"file_path":"src/a.ts"}', '<content>...',
    )
    expect(container.querySelector('span[title="src/a.ts"]')).not.toBeNull()
    expect(container.querySelector('[data-section="input"]')).toBeNull()
    expect(container.querySelector('[data-section="output"]')).not.toBeNull()
  })

  it('keeps the output text of a failed edit, which has no diff body', () => {
    renderCard(toolCell({ toolName: 'edit', isError: true }), '{"file_path":"src/a.ts"}', 'File not found')
    expect(screen.getByText('File not found')).toBeTruthy()
  })

  it('marks a collapsed rich body so its frame and header are hidden', () => {
    const { container } = renderCard(
      toolCell({ toolName: 'bash', toolBody: { kind: 'bash', command: 'ls' } }),
      '{"command":"ls"}', 'a.txt',
    )
    expect(container.querySelector('[data-collapsed]')).not.toBeNull()
  })
})
