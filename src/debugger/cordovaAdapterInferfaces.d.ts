// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.


 interface ICordovaLaunchRequestArgs extends DebugProtocol.LaunchRequestArguments, ICordovaAttachRequestArgs {
    iosDebugProxyPort?: number;
    appStepLaunchTimeout?: number;

    // Ionic livereload properties
    ionicLiveReload?: boolean;
    devServerPort?: number;
    devServerAddress?: string;

    // Chrome debug properties
    url?: string;
    userDataDir?: string;
}

interface ICordovaAttachRequestArgs extends DebugProtocol.AttachRequestArguments, IAttachRequestArgs {
    cwd: string; /* Automatically set by VS Code to the currently opened folder */
    platform: string;
    target?: string;
    webkitRangeMin?: number;
    webkitRangeMax?: number;
    attachAttempts?: number;
    attachDelay?: number;

    // Experimental
    attachUrlOverride?: string;
}