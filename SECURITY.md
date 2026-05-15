# Security Policy

## Reporting a vulnerability

If you find a security issue in Clobber, please report it privately rather than opening a public issue.

Use GitHub's built-in [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository. Do not open a public issue.

We aim to acknowledge reports within 48 hours and provide an initial assessment within a week.

## Scope

Clobber runs as a Chrome extension with access to the File System Access API and (optionally) a localhost Node server. Both of these touch local files, which makes the security surface meaningful even though no network auth or cloud services are involved.

Areas of particular interest:

- **Path traversal in the Node helper.** `edit-helper.js` validates that all write paths stay within the project root and restricts file extensions. Bypasses to either check would be a valid report.
- **Content injection via patched HTML.** Clobber writes user-edited content back to HTML files. If the editing flow can be manipulated to inject content the user didn't author (e.g., via DOM clobbering, prototype pollution, or crafted paste events), that's worth reporting.
- **Extension permission escalation.** If the content script or service worker can be tricked into acting outside the granted directory or executing unintended code, we want to know.

## What's not in scope

- The user intentionally editing their own HTML to include scripts or malicious content. Clobber is a power tool for site owners editing their own files.
- Vulnerabilities in Chrome's File System Access API itself. Report those to the Chromium team.
- Social engineering attacks that require the user to grant folder access to a malicious directory.

## Disclosure

We follow coordinated disclosure. Once a fix is ready and released, we'll credit the reporter (unless they prefer to stay anonymous) and publish a brief advisory if the issue is significant.
