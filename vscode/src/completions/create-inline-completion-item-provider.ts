import * as vscode from 'vscode'

import { Configuration } from '@sourcegraph/cody-shared/src/configuration'
import { FeatureFlag, FeatureFlagProvider } from '@sourcegraph/cody-shared/src/experimentation/FeatureFlagProvider'

import { ContextProvider } from '../chat/ContextProvider'
import { createBfgContextFetcher } from '../graph/bfg/bfg-context-fetcher'
import { logDebug } from '../log'
import { gitDirectoryUri } from '../repository/repositoryHelpers'
import type { AuthProvider } from '../services/AuthProvider'
import { CodyStatusBar } from '../services/StatusBar'

import { CodeCompletionsClient } from './client'
import { GraphSectionObserver } from './context/graph-section-observer'
import { VSCodeDocumentHistory } from './context/history'
import { InlineCompletionItemProvider } from './inline-completion-item-provider'
import { createProviderConfig } from './providers/createProvider'
import { registerAutocompleteTraceView } from './tracer/traceView'

interface InlineCompletionItemProviderArgs {
    config: Configuration
    client: CodeCompletionsClient
    statusBar: CodyStatusBar
    contextProvider: ContextProvider
    featureFlagProvider: FeatureFlagProvider
    authProvider: AuthProvider
}

export async function createInlineCompletionItemProvider(
    { config, client, statusBar, contextProvider, featureFlagProvider, authProvider }: InlineCompletionItemProviderArgs,
    context: vscode.ExtensionContext
): Promise<vscode.Disposable> {
    if (!authProvider.getAuthStatus().isLoggedIn) {
        logDebug('CodyCompletionProvider:notSignedIn', 'You are not signed in.')

        if (config.isRunningInsideAgent) {
            // Register an empty completion provider when running inside the
            // agent to avoid timeouts because it awaits for an
            // `InlineCompletionItemProvider` to be registered.
            return vscode.languages.registerInlineCompletionItemProvider('*', {
                provideInlineCompletionItems: () => Promise.resolve({ items: [] }),
            })
        }

        return {
            dispose: () => {},
        }
    }

    const disposables: vscode.Disposable[] = []

    const [providerConfig, lspGraphContextFlag, completeSuggestWidgetSelectionFlag] = await Promise.all([
        createProviderConfig(config, client, featureFlagProvider, authProvider.getAuthStatus().configOverwrites),
        featureFlagProvider?.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteGraphContext),
        featureFlagProvider?.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteCompleteSuggestWidgetSelection),
    ])
    if (providerConfig) {
        const history = new VSCodeDocumentHistory()
        const isLspGraphContextEnabled =
            config.autocompleteExperimentalGraphContext === 'lsp' ||
            // For backwards compatibility, treat true value as 'lsp'
            config.autocompleteExperimentalGraphContext === true ||
            lspGraphContextFlag
        const graphContextFetcher = isLspGraphContextEnabled
            ? GraphSectionObserver.createInstance()
            : config.autocompleteExperimentalGraphContext === 'bfg'
            ? await createBfgContextFetcher(context, gitDirectoryUri)
            : undefined

        const completionsProvider = new InlineCompletionItemProvider({
            providerConfig,
            history,
            statusBar,
            getCodebaseContext: () => contextProvider.context,
            graphContextFetcher,

            completeSuggestWidgetSelection:
                config.autocompleteExperimentalCompleteSuggestWidgetSelection || completeSuggestWidgetSelectionFlag,
            featureFlagProvider,
        })

        disposables.push(
            vscode.commands.registerCommand('cody.autocomplete.manual-trigger', () =>
                completionsProvider.manuallyTriggerCompletion()
            ),
            vscode.commands.registerCommand(
                'cody.autocomplete.inline.accepted',
                ({ codyLogId, codyCompletion, codyRequest }) => {
                    completionsProvider.handleDidAcceptCompletionItem(codyLogId, codyCompletion, codyRequest)
                }
            ),
            vscode.languages.registerInlineCompletionItemProvider(
                [{ scheme: 'file', language: '*' }, { notebookType: '*' }],
                completionsProvider
            ),
            registerAutocompleteTraceView(completionsProvider)
        )
        if (graphContextFetcher) {
            disposables.push(graphContextFetcher)
        }
    } else if (config.isRunningInsideAgent) {
        throw new Error(
            "Can't register completion provider because `providerConfig` evaluated to `null`. " +
                'To fix this problem, debug why createProviderConfig returned null instead of ProviderConfig. ' +
                'To further debug this problem, here is the configuration:\n' +
                JSON.stringify(config, null, 2)
        )
    }

    return {
        dispose: () => {
            for (const disposable of disposables) {
                disposable.dispose()
            }
        },
    }
}
