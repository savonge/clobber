# Contributing to Clobber

Thanks for wanting to help. Here's how to make it smooth for everyone.

## Before you start

- **Bug or small fix?** Go ahead and open a PR.
- **New feature or big change?** Open an issue first so we can talk through the approach before you write a bunch of code. This saves everyone time if the direction needs adjusting.

## Getting set up

1. Fork and clone the repo
2. Open `chrome://extensions`, enable Developer mode, click "Load unpacked," and point it at the `src/` folder
3. Make a static HTML test page with some `data-edit` attributes and open it in the browser
4. Edit, reload the extension after code changes, test

There's no build step. The extension is plain JS, HTML, and CSS.

## What makes a good PR

- **One concern per PR.** A bug fix and an unrelated refactor should be separate PRs.
- **Test on a real page.** Load the extension, edit some text, replace an image, save, verify the file on disk matches what you expect. Check the git diff.
- **Keep the core invariant.** Saves must never serialize the live DOM. If your change touches the save path, make sure byte-range patching is still doing the work.
- **Don't break normal browsing.** Without activation, the extension should have zero impact on page behavior. Links, buttons, form submissions, everything should work identically to an unmodified page.

## Code style

- No framework, no build tools, no transpilation. Plain browser JS.
- Prefer `const` and `let` over `var`.
- Functions over classes unless there's a strong reason.
- Comments explain *why*, not *what*. The code should explain what.

## Commit messages

Keep them short and descriptive. Start with a verb. Examples:

```
fix: prevent double-patch when editing parent then child
feat: add keyboard shortcut to cycle between editable elements
docs: clarify helper setup for Windows
```

The `fix:`/`feat:`/`docs:` prefix is appreciated but not enforced.

## Reporting bugs

Open an issue with:

1. What you expected
2. What happened instead
3. Browser and OS
4. A minimal HTML page that reproduces it (or a description of the page structure)

Screenshots or screen recordings help a lot, especially for visual/editing bugs.

## Suggesting features

Open an issue tagged `enhancement`. Describe the use case before the solution. "I want to edit link hrefs because I maintain a directory site" is more useful than "add attribute editing."

Stuff explicitly out of scope for v1 (team/auth, cloud, image optimization, non-Vercel deploy targets) is listed in the README. We'll revisit those later.

## Code of conduct

This project follows a [code of conduct](CODE_OF_CONDUCT.md). Be decent.

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.
