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
    // We lazily load BFG to allow the Cody extension finish activation as
    // quickly as possible.
    const loadedBFG = new Promise<MessageHandler>(async (resolve, reject) => {
        try {
            const bfg = new MessageHandler()
            const codyrpc = await downloadBfg(context)
            if (!codyrpc) {
                logDebug(
                    'BFG',
                    'Failed to download BFG binary. To fix this problem, set the "cody.experimental.bfg.path" configuration to the path of your BFG binary'
                )
                reject(Error('BFG: failed to download binary during testing'))
                return
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
            bfg.messageEncoder.pipe(child.stdin)
            await bfg.request('bfg/initialize', { clientName: 'vscode' })
            resolve(bfg)
        } catch (error) {
            reject(error)
        }
    })
    loadedBFG.then(
        () => {},
        error => logDebug('BFG', 'failed to initialize', error)
    )

    let latestRepoIndexing: Promise<void[]> = Promise.resolve([])
    const indexedGitDirectories = new Set<string>()
    const didOpenDocumentUri = async (uri: vscode.Uri): Promise<void> => {
        const gitdir = gitDirectoryUri(uri)?.toString()
        if (gitdir && !indexedGitDirectories.has(gitdir)) {
            indexedGitDirectories.add(gitdir)
            const bfg = await loadedBFG
            const indexingStartTime = Date.now()
            await bfg.request('bfg/gitRevision/didChange', { gitDirectoryUri: gitdir })
            logDebug('BFG', `indexing time ${Date.now() - indexingStartTime}ms`)
        }
    }
    latestRepoIndexing = Promise.all(
        vscode.window.visibleTextEditors.map(textEditor => didOpenDocumentUri(textEditor.document.uri))
    )
    vscode.workspace.onDidOpenTextDocument(document => didOpenDocumentUri(document.uri))
    return {
        getContextAtPosition: async (document, position, _unusedMaxChars, contextRange) => {
            const bfg = await loadedBFG
            if (!bfg.isAlive()) {
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
        dispose: () =>
            loadedBFG.then(
                bfg => bfg.request('bfg/shutdown', null),
                () => {}
            ),
    }
}
