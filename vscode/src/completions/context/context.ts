import * as vscode from 'vscode'

import { CodebaseContext } from '@sourcegraph/cody-shared/src/codebase-context'

import { History } from '../history'

import { getContextFromEmbeddings } from './context-embeddings'
import { getContextFromCurrentEditor } from './context-local'
import { getContextFromCodeNav } from './context-vscode-nav'

/**
 * Keep property names in sync with the `EmbeddingsSearchResult` type.
 */
export interface ReferenceSnippet {
    fileName: string
    content: string
}

export interface GetContextOptions {
    document: vscode.TextDocument
    history: History
    position: vscode.Position
    prefix: string
    suffix: string
    jaccardDistanceWindowSize: number
    maxChars: number
    codebaseContext: CodebaseContext
    isEmbeddingsContextEnabled?: boolean
}

export interface GetContextResult {
    context: ReferenceSnippet[]
    logSummary: {
        embeddings?: number
        local?: number
        duration: number
    }
}

export async function getContext(options: GetContextOptions): Promise<GetContextResult> {
    const { maxChars, isEmbeddingsContextEnabled } = options
    const start = performance.now()

    /**
     * The embeddings context is sync to retrieve to keep the completions latency minimal. If it's
     * not available in cache yet, we'll retrieve it in the background and cache it for future use.
     */
    const embeddingsMatches = isEmbeddingsContextEnabled ? getContextFromEmbeddings(options) : []

    const [localMatches, codeNavMatches] = await Promise.all([
        getContextFromCurrentEditor(options),
        getContextFromCodeNav(options),
    ])

    /**
     * Iterate over matches and add them to the context.
     * Discard editor matches for files with embedding matches.
     */
    const usedFilenames = new Set<string>()
    const context: ReferenceSnippet[] = []
    let totalChars = 0
    function addMatch(match: ReferenceSnippet): boolean {
        if (usedFilenames.has(match.fileName)) {
            return false
        }
        usedFilenames.add(match.fileName)

        if (totalChars + match.content.length > maxChars) {
            return false
        }
        context.push(match)
        totalChars += match.content.length
        return true
    }

    let includedCodeNavMatches = 0
    for (const match of codeNavMatches) {
        if (addMatch(match)) {
            includedCodeNavMatches++
        }
    }

    let includedEmbeddingsMatches = 0
    for (const match of embeddingsMatches) {
        if (addMatch(match)) {
            includedEmbeddingsMatches++
        }
    }

    let includedLocalMatches = 0
    for (const match of localMatches) {
        if (addMatch(match)) {
            includedLocalMatches++
        }
    }

    return {
        context,
        logSummary: {
            ...(includedEmbeddingsMatches ? { embeddings: includedEmbeddingsMatches } : {}),
            ...(includedLocalMatches ? { local: includedLocalMatches } : {}),
            ...(includedCodeNavMatches ? { codeNav: includedCodeNavMatches } : {}),
            duration: performance.now() - start,
        },
    }
}