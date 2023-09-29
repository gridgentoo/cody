import * as child_process from 'child_process'

import * as vscode from 'vscode'

import { GraphContextFetcher } from '../../completions/context/context-graph'
import { MessageHandler } from '../../jsonrpc/jsonrpc'
import { logDebug } from '../../log'

import { downloadBfg } from './download-bfg'

export function createBfgContextFetcher(
    context: vscode.ExtensionContext,
    gitDirectoryUri: (uri: vscode.Uri) => vscode.Uri | undefined
): GraphContextFetcher {
    const isTesting = process.env.CODY_TESTING === 'true'
    let isInitialized = false
    const bfg = new MessageHandler()

    // We lazily load BFG to allow the Cody extension finish activation as
    // quickly as possible.
    let initialize: Promise<boolean> | undefined
    const doInitialize = async (): Promise<boolean> => {
        if (isInitialized) {
            return true && bfg.isAlive()
        }
        logDebug('BFG', 'Creating BFG client')
        const codyrpc = await downloadBfg(context)
        if (!codyrpc) {
            if (isTesting) {
                throw new Error('BFG: failed to download binary during testing')
            }
            logDebug(
                'BFG',
                'Failed to download BFG binary. To fix this problem, set the "cody.experimental.bfg.path" configuration to the path of your BFG binary'
            )
            return false
        }
        const child = child_process.spawn(codyrpc, { stdio: 'pipe' })
        child.stderr.on('data', chunk => {
            if (isTesting) console.log(chunk.toString())
            else logDebug('BFG', 'stderr output', chunk.toString())
        })
        child.on('exit', () => {
            bfg.exit()
        })
        child.stderr.pipe(process.stdout)
        child.stdout.pipe(bfg.messageDecoder)
        isInitialized = true
        bfg.messageEncoder.pipe(child.stdin)
        await bfg.request('bfg/initialize', { clientName: 'vscode' })
        return true
    }

    let latestRepoIndexing = Promise.resolve()
    const indexedGitDirectories = new Set<string>()
    const didOpenDocumentUri = (uri: vscode.Uri): void => {
        const gitdir = gitDirectoryUri(uri)?.toString()
        if (gitdir && !indexedGitDirectories.has(gitdir)) {
            indexedGitDirectories.add(gitdir)
            const indexingStartTime = Date.now()
            latestRepoIndexing = bfg.request('bfg/gitRevision/didChange', { gitDirectoryUri: gitdir })
            latestRepoIndexing.then(
                () => logDebug('BFG', `indexing time ${Date.now() - indexingStartTime}ms`),
                error =>
                    logDebug(
                        'BFG',
                        `indexing git repo ${gitdir} failed due to ${error}`,
                        error instanceof Error ? error.stack : undefined
                    )
            )
        }
    }
    for (const textEditor of vscode.window.visibleTextEditors) {
        didOpenDocumentUri(textEditor.document.uri)
    }
    vscode.workspace.onDidOpenTextDocument(document => {
        didOpenDocumentUri(document.uri)
    })
    return {
        getContextAtPosition: async (document, position, _unusedMaxChars, contextRange) => {
            if (!initialize) {
                initialize = doInitialize()
            }
            const isAlive = await initialize
            if (!isAlive) {
                logDebug('BFG', 'BFG is not alive')
                return []
            }
            await latestRepoIndexing
            const responses = await bfg.request('bfg/contextAtPosition', {
                uri: document.uri.toString(),
                content: (await vscode.workspace.openTextDocument(document.uri)).getText(),
                position: { line: position.line, character: position.character },
                maxChars: 1337, // ignored by BFG server for now
                contextRange,
            })

            logDebug('BFG', 'graph symbol count ' + responses.symbols.length)

            return [...responses.symbols, ...responses.files]
        },
        messageHandler: bfg,
        dispose: () => bfg.request('bfg/shutdown', null),
    }
}
