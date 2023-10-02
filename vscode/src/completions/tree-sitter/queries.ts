import dedent from 'dedent'

import { SupportedLanguage } from './grammars'

export type QueryName = 'blocks' | 'multilineTriggers' | 'singlelineTriggers'

const JS_BLOCKS_QUERY = dedent`
    (_ ("{")) @blocks

    [(try_statement)
    (if_statement)] @parents
`

// Figure out if it's possible to resuse the #match part of the query on the query level.
const MULTILINE_TRIGGERS_QUERY = dedent`
    (function_declaration (statement_block ("{") @block_start)) @trigger
    (function (statement_block ("{") @block_start)) @trigger
    (arrow_function (statement_block ("{") @block_start)) @trigger
`

const SINGLELINE_TRIGGERS_QUERY = dedent`
    (interface_declaration (object_type ("{") @block_start)) @trigger
    (type_alias_declaration (object_type ("{") @block_start)) @trigger
`

export const languages: Partial<Record<SupportedLanguage, Record<QueryName, string>>> = {
    [SupportedLanguage.JavaScript]: {
        blocks: JS_BLOCKS_QUERY,
        multilineTriggers: MULTILINE_TRIGGERS_QUERY,
        singlelineTriggers: '',
    },
    [SupportedLanguage.JSX]: {
        blocks: JS_BLOCKS_QUERY,
        multilineTriggers: MULTILINE_TRIGGERS_QUERY,
        singlelineTriggers: '',
    },
    [SupportedLanguage.TypeScript]: {
        blocks: JS_BLOCKS_QUERY,
        multilineTriggers: MULTILINE_TRIGGERS_QUERY,
        singlelineTriggers: SINGLELINE_TRIGGERS_QUERY,
    },
    [SupportedLanguage.TSX]: {
        blocks: JS_BLOCKS_QUERY,
        multilineTriggers: MULTILINE_TRIGGERS_QUERY,
        singlelineTriggers: SINGLELINE_TRIGGERS_QUERY,
    },
    [SupportedLanguage.Go]: {
        blocks: '(_ ("{")) @blocks',
        multilineTriggers: '',
        singlelineTriggers: dedent`
            (struct_type (field_declaration_list ("{") @block_start)) @trigger
            (interface_type ("{") @block_start) @trigger
        `,
    },
} as const
