/**
 * This file declares the protocol for communicating between Cody and BFG (Blazingly Fast Graph), a Rust implementation
 * of the "Graph Context" feature flag.
 */
import { FileContextSnippet, SymbolContextSnippet } from '../completions/types'

import { Position, Range } from './agent-protocol'

export type Requests = {
    'bfg/initialize': [{ clientName: string }, { serverVersion: string }]
    'bfg/contextAtPosition': [
        { uri: string; content: string; position: Position; maxChars: number; contextRange?: Range },
        { symbols: SymbolContextSnippet[]; files: FileContextSnippet[] },
    ]
    'bfg/gitRevision/didChange': [{ gitDirectoryUri: string }, void]
    'bfg/shutdown': [null, void]
}

export type Notifications = {
    'bfg/placeholderNotification': [null]
}
