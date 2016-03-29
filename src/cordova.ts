// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {CordovaProjectHelper} from './utils/cordovaProjectHelper';
import {CordovaCommandHelper} from './utils/cordovaCommandHelper';
import {ExtensionServer} from './extension/extensionServer';
import * as Q from 'q';
import {Telemetry} from './utils/telemetry';
import {TelemetryHelper} from './utils/telemetryHelper';
import {TsdHelper} from './utils/tsdHelper';

let PLUGIN_TYPE_DEFS_FILENAME = 'pluginTypings.json';
let PLUGIN_TYPE_DEFS_PATH = path.resolve(__dirname, '..', '..', PLUGIN_TYPE_DEFS_FILENAME);
let CORDOVA_TYPINGS_QUERYSTRING = 'cordova';
let JSCONFIG_FILENAME = 'jsconfig.json';
let TSCONFIG_FILENAME = 'tsconfig.json';

export function activate(context: vscode.ExtensionContext): void {
    // Asynchronously enable telemetry
    Telemetry.init('cordova-tools', require('./../../package.json').version, {isExtensionProcess: true});
    // Get the project root and check if it is a Cordova project
    let cordovaProjectRoot = CordovaProjectHelper.getCordovaProjectRoot(vscode.workspace.rootPath);

    if (!cordovaProjectRoot) {
        return;
    }

    let activateExtensionEvent = TelemetryHelper.createTelemetryEvent('activate');

    TelemetryHelper.determineProjectTypes(cordovaProjectRoot)
        .then((projectType) => {
            /* tslint:disable:no-string-literal */
            activateExtensionEvent.properties['projectType'] = projectType;
            /* tslint:disable:no-string-literal */
        })
        .finally(() => {
            Telemetry.send(activateExtensionEvent);
        }).done();

    // We need to update the type definitions added to the project
    // as and when plugins are added or removed. For this reason,
    // setup a file system watcher to watch changes to plugins in the Cordova project
    // Note that watching plugins/fetch.json file would suffice

    let watcher = vscode.workspace.createFileSystemWatcher('**/plugins/fetch.json', false /*ignoreCreateEvents*/, false /*ignoreChangeEvents*/, false /*ignoreDeleteEvents*/);

    watcher.onDidChange((e: vscode.Uri) => updatePluginTypeDefinitions(cordovaProjectRoot));
    watcher.onDidDelete((e: vscode.Uri) => updatePluginTypeDefinitions(cordovaProjectRoot));
    watcher.onDidCreate((e: vscode.Uri) => updatePluginTypeDefinitions(cordovaProjectRoot));

    context.subscriptions.push(watcher);
    let extensionServer: ExtensionServer = new ExtensionServer();
    extensionServer.setup();
    context.subscriptions.push(extensionServer);

    // Register Cordova commands
    context.subscriptions.push(vscode.commands.registerCommand('cordova.prepare',
        () => CordovaCommandHelper.executeCordovaCommand(cordovaProjectRoot, 'prepare')));
    context.subscriptions.push(vscode.commands.registerCommand('cordova.build',
        () => CordovaCommandHelper.executeCordovaCommand(cordovaProjectRoot, 'build')));
    context.subscriptions.push(vscode.commands.registerCommand('cordova.run',
        () => CordovaCommandHelper.executeCordovaCommand(cordovaProjectRoot, 'run')));

    let pluginTypings = getPluginTypingsJson();
    if (!pluginTypings) {
        return;
    }

    // Install the type defintion files for Cordova
    TsdHelper.installTypings(CordovaProjectHelper.getOrCreateTypingsTargetPath(cordovaProjectRoot), [pluginTypings[CORDOVA_TYPINGS_QUERYSTRING].typingFile]);

    // Install type definition files for the currently installed plugins
    updatePluginTypeDefinitions(cordovaProjectRoot);

    // In VSCode 0.10.10+, if the root doesn't contain jsconfig.json or tsconfig.json, intellisense won't work for files without /// typing references, so add a jsconfig.json here if necessary
    let jsconfigPath: string = path.join(vscode.workspace.rootPath, JSCONFIG_FILENAME);
    let tsconfigPath: string = path.join(vscode.workspace.rootPath, TSCONFIG_FILENAME);

    Q.all([Q.nfcall(fs.exists, jsconfigPath), Q.nfcall(fs.exists, tsconfigPath)]).spread((jsExists: boolean, tsExists: boolean) => {
        if (!jsExists && !tsExists) {
            Q.nfcall(fs.writeFile, jsconfigPath, '{}').then(() => {
                // Any open file must be reloaded to enable intellisense on them, so inform the user
                vscode.window.showInformationMessage('To enable IntelliSense a "jsconfig.json" file was added to your project. Please close and reopen any active JavaScript file(s).');
            });
        }
    });
}

export function deactivate(context: vscode.ExtensionContext): void {
    console.log('Extension has been deactivated');
}

function getPluginTypingsJson(): any {
    if (CordovaProjectHelper.existsSync(PLUGIN_TYPE_DEFS_PATH)) {
        return require(PLUGIN_TYPE_DEFS_PATH);
    }

    console.error('Cordova plugin type declaration mapping file "pluginTypings.json" is missing from the extension folder.');
    return null;
}

function getNewTypeDefinitions(installedPlugins: string[]): string[] {
    let pluginTypings = getPluginTypingsJson();
    if (!pluginTypings) {
        return;
    }

    return installedPlugins.filter(pluginName => !!pluginTypings[pluginName])
        .map(pluginName => pluginTypings[pluginName].typingFile);
}

function addPluginTypeDefinitions(projectRoot: string, installedPlugins: string[], currentTypeDefs: string[]): void {
    let pluginTypings = getPluginTypingsJson();
    if (!pluginTypings) {
        return;
    }

    let typingsToAdd = installedPlugins.filter((pluginName: string) => {
        if (pluginTypings[pluginName]) {
            return currentTypeDefs.indexOf(pluginTypings[pluginName].typingFile) < 0;
        }

        // If we do not know the plugin, collect it anonymously for future prioritisation
        let unknownPluginEvent = TelemetryHelper.createTelemetryEvent('unknownPlugin');
        unknownPluginEvent.setPiiProperty('plugin', pluginName);
        Telemetry.send(unknownPluginEvent);
        return false;
    }).map((pluginName: string) => {
        return pluginTypings[pluginName].typingFile;
    });

    TsdHelper.installTypings(CordovaProjectHelper.getOrCreateTypingsTargetPath(projectRoot), typingsToAdd);
}

function removePluginTypeDefinitions(projectRoot: string, currentTypeDefs: string[], newTypeDefs: string[]): void {
    // Find the type definition files that need to be removed
    currentTypeDefs.forEach((typeDef: string) => {
        if (newTypeDefs.indexOf(typeDef) < 0) {
            let fileToDelete = path.resolve(CordovaProjectHelper.getOrCreateTypingsTargetPath(projectRoot), typeDef);
            fs.unlink(fileToDelete, (err: Error) => {
                if (err) {
                    // Debug-only message
                    console.log('Failed to delete file ' + fileToDelete);
                }
            });
        }
    });
}

function getRelativeTypeDefinitionFilePath(projectRoot: string, parentPath: string, typeDefinitionFile: string) {
    return path.relative(CordovaProjectHelper.getOrCreateTypingsTargetPath(projectRoot), path.resolve(parentPath, typeDefinitionFile)).replace(/\\/g, '\/');
}

function updatePluginTypeDefinitions(cordovaProjectRoot: string): void {
    let installedPlugins: string[] = CordovaProjectHelper.getInstalledPlugins(cordovaProjectRoot);
    let newTypeDefs = getNewTypeDefinitions(installedPlugins);
    let cordovaPluginTypesFolder = CordovaProjectHelper.getCordovaPluginTypeDefsPath(cordovaProjectRoot);
    let ionicPluginTypesFolder = CordovaProjectHelper.getIonicPluginTypeDefsPath(cordovaProjectRoot);

    if (!CordovaProjectHelper.existsSync(cordovaPluginTypesFolder)) {
        addPluginTypeDefinitions(cordovaProjectRoot, installedPlugins, []);
        return;
    }

    let currentTypeDefs: string[] = [];

    // Now read the type definitions of Cordova plugins
    fs.readdir(cordovaPluginTypesFolder, (err: Error, cordovaTypeDefs: string[]) => {
        if (cordovaTypeDefs) {
            currentTypeDefs = cordovaTypeDefs.map(typeDef => getRelativeTypeDefinitionFilePath(cordovaProjectRoot, cordovaPluginTypesFolder, typeDef));
        }

        // Now read the type definitions of Ionic plugins
        fs.readdir(ionicPluginTypesFolder, (innerErr: Error, ionicTypeDefs: string[]) => {
            if (ionicTypeDefs) {
                currentTypeDefs.concat(ionicTypeDefs.map(typeDef => getRelativeTypeDefinitionFilePath(cordovaProjectRoot, ionicPluginTypesFolder, typeDef)));
            }

            addPluginTypeDefinitions(cordovaProjectRoot, installedPlugins, currentTypeDefs);
            removePluginTypeDefinitions(cordovaProjectRoot, currentTypeDefs, newTypeDefs);
        });
    });
}