import { promises as fspromises } from 'fs'
import path from 'path'

import * as vscode from 'vscode'

import { downloadFile, fileExists } from '../../local-context/download-symf'
import { logDebug } from '../../log'
import { getOSArch } from '../../os'

const bfgVersion = '0.1.0'

export async function downloadBfg(context: vscode.ExtensionContext): Promise<string | null> {
    const config = vscode.workspace.getConfiguration()
    const userBfgPath = config.get<string>('cody.experimental.bfg.path')
    if (userBfgPath) {
        logDebug('bfg', `using user bfg: ${userBfgPath}`)
        return userBfgPath
    }

    const osArch = getOSArch()
    if (!osArch) {
        return null
    }
    const { platform, arch } = osArch

    const bfgContainingDir = path.join(context.globalStorageUri.fsPath, 'bfg')
    const bfgFilename = `bfg-${bfgVersion}-${arch}-${platform}`
    const bfgPath = path.join(bfgContainingDir, bfgFilename)
    const isAlreadyDownloaded = await fileExists(bfgPath)
    if (isAlreadyDownloaded) {
        logDebug('bfg', `using downloaded bfg "${bfgPath}"`)
        return bfgPath
    }

    const bfgURL = `https://github.com/sourcegraph/bfg/releases/download/${bfgVersion}/bfg-${arch}-${platform}.zip`
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Downloading code graph utility "bfg"',
                cancellable: false,
            },
            async progress => {
                progress.report({ message: 'Downloading bfg and extracting bfg' })

                const bfgTmpDir = bfgPath + '.tmp'

                await downloadFile(bfgURL, bfgTmpDir)
                logDebug('BFG', `downloaded bfg to ${bfgTmpDir}`)

                const tmpFile = path.join(bfgTmpDir, `bfg-${arch}-${platform}`)
                await fspromises.chmod(tmpFile, 0o755)
                await fspromises.rename(tmpFile, bfgPath)
                await fspromises.rmdir(bfgTmpDir, { recursive: true })

                logDebug('BFG', `extracted BFG to ${bfgPath}`)
            }
        )
        void removeOldBfgBinaries(bfgContainingDir, bfgFilename)
    } catch (error) {
        void vscode.window.showErrorMessage(`Failed to download bfg: ${error}`)
        return null
    }
    return bfgPath
}

async function removeOldBfgBinaries(containingDir: string, currentBfgPath: string): Promise<void> {
    const bfgDirContents = await fspromises.readdir(containingDir)
    const oldBfgBinaries = bfgDirContents.filter(f => f.startsWith('bfg-') && f !== currentBfgPath)
    for (const oldBfgBinary of oldBfgBinaries) {
        await fspromises.rm(path.join(containingDir, oldBfgBinary))
    }
}
