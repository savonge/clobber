# Privacy Policy for Clobber

**Last updated:** May 2026

## Overview

Clobber is a Chrome extension for editing text and images on your own static HTML sites. It operates entirely on your local machine and does not collect, transmit, or store any personal data.

## What data Clobber accesses

Clobber accesses the content of web pages you activate it on in order to enable inline editing. Specifically:

- **Page HTML source:** Fetched from the current tab to build the source-DOM pairing and position map that power the editing and save system.
- **Local files:** When you save, Clobber reads and writes files within a folder you explicitly grant access to via Chrome's File System Access API directory picker.
- **Extension storage:** Your settings (deploy hook URL and folder preferences) are stored locally in Chrome's extension storage (`chrome.storage.local`). This data never leaves your browser.
- **IndexedDB:** The File System Access directory handle is cached in IndexedDB so you don't have to re-pick your project folder every session.

## What data Clobber does NOT access

- Clobber does not collect analytics or telemetry of any kind.
- Clobber does not transmit data to any external server.
- Clobber does not read pages you haven't activated it on.
- Clobber does not access browsing history, cookies, passwords, or any data outside the current page and the folder you've granted access to.

## Optional Node helper

If you choose to use the optional Node helper server (`edit-helper.js`) for browsers without File System Access support, that server runs on your local machine (localhost only) and does not communicate with any external service.

## Optional deploy hook

If you configure a Vercel deploy hook URL, Clobber sends a POST request to that URL when you click Deploy. The request contains no user data; it simply triggers a deploy on your Vercel project. No other network requests are made.

## Third parties

Clobber does not use any third-party services, SDKs, analytics libraries, or advertising networks.

## Data retention

All data stays on your local machine. Uninstalling the extension removes all stored settings and cached directory handles.

## Changes to this policy

If this policy changes, the updated version will be posted in the GitHub repository and the Chrome Web Store listing.

## Contact

For questions about this policy, open an issue on the GitHub repository: https://github.com/savonge/clobber
