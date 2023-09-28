import * as child_process from 'child_process'

import * as vscode from 'vscode'

import { emptyGraphContextFetcher, GraphContextFetcher } from '../../completions/context/context-graph'
import { MessageHandler } from '../../jsonrpc/jsonrpc'
import { logDebug } from '../../log'

import { downloadBfg } from './download-bfg'

export async function createBfgContextFetcher(
    context: vscode.ExtensionContext,
    gitDirectoryUri: (uri: vscode.Uri) => vscode.Uri | undefined
): Promise<GraphContextFetcher> {
    const isTesting = process.env.CODY_TESTING === 'true'
    logDebug('BFG', 'Creating BFG context fetcher')
    const codyrpc = await downloadBfg(context)
    if (!codyrpc) {
        if (isTesting) {
            throw new Error('BFG: failed to download binary during testing')
        }
        logDebug(
            'BFG',
            'failed to download BFG binary. To fix this problem, set the "cody.experimental.bfg.path" configuration to the path of your BFG binary'
        )
        return emptyGraphContextFetcher
    }
    const child = child_process.spawn(codyrpc, { stdio: 'pipe' })
    const bfg = new MessageHandler()
    console.log({ isTesting })
    child.stderr.on('data', chunk => {
        if (isTesting) console.log(chunk.toString())
        else logDebug('BFG:data', chunk.toString())
    })
    child.on('exit', () => {
        bfg.die()
    })
    child.stderr.pipe(process.stdout)
    child.stdout.pipe(bfg.messageDecoder)
    bfg.messageEncoder.pipe(child.stdin)
    await bfg.request('bfg/initialize', { clientName: 'vscode' })
    let latestRepoIndexing = Promise.resolve()
    const indexedGitDirectories = new Set<string>()
    const didOpenDocumentUri = (uri: vscode.Uri): void => {
        const gitdir = gitDirectoryUri(uri)?.toString()
        if (gitdir && !indexedGitDirectories.has(gitdir)) {
            indexedGitDirectories.add(gitdir)
            latestRepoIndexing = bfg.request('bfg/gitRevision/didChange', { gitDirectoryUri: gitdir })
        }
    }
    for (const textEditor of vscode.window.visibleTextEditors) {
        didOpenDocumentUri(textEditor.document.uri)
    }
    vscode.workspace.onDidOpenTextDocument(document => {
        didOpenDocumentUri(document.uri)
    })
    return {
        getContextAtPosition: async (document, position, maxChars, contextRange) => {
            if (!bfg.isAlive()) {
                logDebug('BFG', 'BFG is not alive')
                return []
            }
            await latestRepoIndexing
            const responses = await bfg.request('bfg/contextAtPosition', {
                uri: document.uri.toString(),
                content: (await vscode.workspace.openTextDocument(document.uri)).getText(),
                position: { line: position.line, character: position.character },
                maxChars: 10_000, // maxChars || 0
                contextRange,
            })

            logDebug('BFG', 'graph symbol count ' + responses.symbols.length)

            return [...responses.symbols, ...responses.files]
        },
        messageHandler: bfg,
        dispose: () => bfg.request('bfg/shutdown', null),
    }
}
