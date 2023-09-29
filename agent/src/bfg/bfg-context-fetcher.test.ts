import * as child_process from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import path from 'path'

import * as rimraf from 'rimraf'
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'

import { initTreeSitterParser } from '../../../vscode/src/completions/test-helpers'
import { createBfgContextFetcher } from '../../../vscode/src/graph/bfg/bfg-context-fetcher'
import { Agent, initializeVscodeExtension } from '../agent'
import { MessageHandler } from '../jsonrpc-alias'
import * as vscode_shim from '../vscode-shim'

let dir = path.join(process.cwd(), 'agent', 'src', 'bfg', '__tests__', 'typescript')
if (!fs.existsSync(dir)) {
    dir = path.join(process.cwd(), 'src', 'bfg', '__tests__', 'typescript')
}
const bfgCratePath = process.env.BFG_CRATE_PATH
const testFile = path.join('src', 'main.ts')
const gitdir = path.join(dir, '.git')
const shouldCreateGitDir = !fs.existsSync(gitdir)

describe('BfgContextFetcher', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfg-'))
    beforeAll(async () => {
        process.env.CODY_TESTING = 'true'
        await initTreeSitterParser()
        initializeVscodeExtension()
        if (shouldCreateGitDir) {
            child_process.execSync('git init', { cwd: dir })
            child_process.execSync('git add .', { cwd: dir })
            child_process.execSync('git commit -m "First commit"', { cwd: dir })
        }

        if (bfgCratePath && process.env.BFG_BUILD === 'true') {
            child_process.execSync('cargo build', { cwd: bfgCratePath })
        }
    })
    afterAll(() => {
        if (shouldCreateGitDir) {
            rimraf.rimrafSync(gitdir)
            // rimraf.rimrafSync(tmpDir)
        }
    })

    const agent = new Agent()

    const debugHandler = new MessageHandler()
    debugHandler.registerNotification('debug/message', params => console.log(`${params.channel}: ${params.message}`))
    debugHandler.messageEncoder.pipe(agent.messageDecoder)
    agent.messageEncoder.pipe(debugHandler.messageDecoder)

    const filePath = path.join(dir, testFile)
    const content = fs.readFileSync(filePath, 'utf8')
    const CURSOR = '/*CURSOR*/'
    it('returns non-empty context', async () => {
        const gitdirUri = vscode.Uri.from({ scheme: 'file', path: gitdir })
        if (bfgCratePath) {
            const bfgBinary = path.join(bfgCratePath, '..', '..', 'target', 'debug', 'bfg')
            vscode_shim.customConfiguration['cody.experimental.bfg.path'] = bfgBinary
        }
        const extensionContext: Partial<vscode.ExtensionContext> = {
            globalStorageUri: vscode.Uri.from({ scheme: 'file', path: tmpDir }),
        }
        agent.workspace.addDocument({
            filePath,
            content: content.replace(CURSOR, ''),
        })

        const bfg = createBfgContextFetcher(extensionContext as vscode.ExtensionContext, () => gitdirUri)

        const doc = agent.workspace.agentTextDocument({ filePath })
        assert(doc.getText().length > 0)
        const offset = content.indexOf(CURSOR)
        assert(offset >= 0, content)
        const position = doc.positionAt(offset)
        const maxChars = 1_000

        expect(await bfg.getContextAtPosition(doc, position, maxChars, undefined)).toHaveLength(2)
    })
})
