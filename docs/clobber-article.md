# The Tiniest CMS in Existence

## Or how being too lazy to open my code editor made me build a tool

A few weeks ago, I built a small landing page for myself.

It was intentionally simple: static HTML, some CSS, a few images, no framework, no database, no CMS. Claude Code helped me move fast. It pulled designs from Figma through MCP, generated the structure, and pretty quickly I had a working page that did exactly what I needed.

It was lightweight, understandable, and easy to ship.

Then I needed to change one sentence.

Not redesign the page. Not rebuild a section. Just try a slightly different line of copy and see how it felt in context.

Suddenly I had two options, and neither felt right.

The first option was to open the code editor. Find the right file, find the right section, change the text, save, refresh the browser, check how it looked, then jump back to the editor if it still felt off. Technically simple, but weirdly heavy. The actual edit might take five seconds, but the loop around it made the change feel bigger than it was.

The second option was to ask Claude to do it for me. Also possible, and also slightly absurd. I could describe the change, wait for Claude to make it, review the diff, approve it, run the update, and eventually deploy. That workflow is magical when the task has real substance. For "try a warmer headline," it felt like ordering a moving truck to carry a coffee mug across the room.

All of this for one sentence.

A sentence, by the way, that I was not even sure I liked yet.

That was the moment I realized what I actually wanted: I did not want someone, or something, to edit the page for me. I wanted to edit the page myself, directly, in the place where I could see whether the edit worked.

And apparently, I am willing to build software to avoid opening software.

## The site did not need a CMS

To be clear, this site absolutely did not need a real CMS.

It did not need users, roles, drafts, approvals, structured content models, reusable blocks, localization, or a media library full of files called `hero-final-final-v3.jpg`.

It was a small static site. But it did need a better way to make small edits.

That is the funny thing about static pages. They are perfect right up until they become real. Once a page is live, you start noticing things. A headline feels a bit stiff. A CTA could be sharper. An image works technically, but not emotionally. A paragraph reads fine in isolation but feels dense inside the layout.

None of these are big tasks. But if the workflow around them is too big, they stop happening naturally. You batch them. You postpone them. You add them to a list called "later," which is where tiny improvements quietly disappear.

I wanted the editing experience to match the size of the edit.

A tiny change should require tiny effort.

## What I wanted was embarrassingly simple

I wanted to open the page in Chrome and edit the page itself.

Not open an admin dashboard. Not connect a CMS. Not define schemas. Not create a content pipeline for a site that was basically a few nice sections and a button.

I wanted to Cmd-click a headline, type a better headline, Cmd-click an image, pick a replacement, hit publish, and move on.

That was the whole idea: a CMS reduced to its smallest useful surface area.

The part where you edit the thing.

No ceremony. No platform. No "content operations." Just the page.

## So I built Clobber

The tool is called **Clobber**.

The tagline is:

**Cmd-click to edit your own static sites.**

Clobber is a small editing layer for static HTML pages. You mark elements as editable with a `data-edit` attribute, turn on Clobber, and then edit text or swap images directly in the browser. Changes are written back to your local files, and a deploy hook button can push the update live.

That is the whole product.

It is not trying to be a serious CMS. It does not want to manage your publishing workflow or become the canonical place where content lives. The content already lives on the page. Clobber just lets you edit it there.

## The best design decision was restraint

The obvious first version of this idea is: make the page editable.

That sounds nice until you think about it for more than nine seconds.

You do not want everything on the page to be editable. Some things are content. Some things are structure. Some things you want to casually tweak, and some things should remain exactly where they are unless you are intentionally changing the site.

So Clobber is opt-in.

You mark editable elements like this:

```html
<h1 data-edit="hero.title">Your original headline</h1>
```

That small `data-edit` attribute creates a useful boundary. It tells Clobber: this is content, this can be changed, this is safe to expose in the editing layer.

That decision made the whole tool feel calmer. It also kept the scope honest. The point was never to turn a static site into a full visual builder. The point was to make obvious edits obvious.

I like tools that do less, but do the right less.

## The technical trap: saving without making a mess

At first, browser editing sounds straightforward. Click text, change text, save HTML. Easy.

Unfortunately, the browser has opinions.

A lot of browser-based editing tools save by serializing the live DOM back into HTML. That can get messy quickly. JavaScript-generated content can get baked into the saved file. Formatting can change even when the content did not. Git diffs can explode with noise. Save and reload enough times, and your simple HTML starts to look like it was gently attacked by a formatting raccoon.

Clobber avoids this by not saving the live DOM.

Instead, it fetches the original source HTML and parses it into a separate shadow document. It then pairs elements on the live page with their source equivalents. Dynamic content that does not exist in the original source is structurally excluded from editing.

When you make an edit, Clobber records it as a byte-range patch against the original source string. On save, those patches are applied back into the original file, without touching anything outside the edited range.

The result is boring in the best possible way: your Git diff shows the sentence you changed, not a surprise renovation of the entire file.

## The real benefit is emotional

The best part of Clobber is not technical. It is that editing feels casual again.

Before Clobber, I would notice something and think, "I should fix that later." After Clobber, I just fix it.

Cmd-click. Type. Publish.

That changes your relationship with the page. It stops feeling like a small software project that needs a maintenance session and starts feeling like something you can continuously tune.

It also changes the writing. Copy that sounds good in a doc can feel too long in a hero section. A CTA that works in isolation can feel too loud next to an image. A paragraph that reads well in notes can look heavy once it sits inside the layout.

Writing directly inside the layout removes that delay. You are no longer writing somewhere else and discovering the truth later. The copy is born where it has to live.

That sounds obvious, but I apparently had to build the tiniest CMS in existence to fully appreciate it.

## There are two ways to use it

Clobber has a Chrome extension and a Claude Code skill, and the split is intentional.

The **Chrome extension** is for editing. Install it, point it at your project folder, and Cmd-click your way through whatever needs changing. It talks directly to your local files through Chrome's File System Access API. No server, no extra setup. A deploy hook in the settings fires a Vercel publish when you're ready.

The **Claude Code skill** is for setup. You type `/clobber` inside a Claude Code session, and Claude scans your HTML files, figures out which elements should be editable, adds `data-edit` attributes with sensible names, and wires everything up. When you want it gone, `/clobber off` strips it all back out and restores the original HTML.

The reason this division feels right is that setup and editing are genuinely different jobs. Setup requires judgment: which elements are content, what should the keys be named, which containers should be left alone. That is exactly the kind of structural thinking Claude is good at. Editing, on the other hand, is fast and tactile and belongs in the browser, not in a chat window.

Claude prepares the site. Clobber edits the site. You avoid spelunking through HTML for a typo.

Everyone plays to their strengths.

## This started as laziness, which I think is fine

There is a useful kind of laziness that does not mean "I do not want to do the work." It means, "This workflow is annoying, and I refuse to believe it has to stay this way."

That kind of laziness notices friction. It questions ceremony. It asks why a 10-second change requires a 10-step process.

Clobber came from that. I did not sit down to build a product. I sat down to avoid repeating a tiny irritation.

But the part that feels bigger than Clobber is how achievable this kind of thing has become. A few years ago, building a custom tool for a problem this specific would have felt hard to justify. You would either tolerate the workflow or adopt a much larger tool built for a more complex situation.

Now the cost of making small, personal tools has dropped dramatically. Not to zero. You still need judgment, taste, debugging, and a decent sense of where the sharp edges are. But the distance between "this is annoying" and "I made a tool that fixes it" is much shorter than it used to be.

That changes the math.

Sometimes it is now easier to build the exact tiny thing you need than to reshape your workflow around software built for someone else.

## Not every tool needs to become a company

I like this new category of software: tools that are too specific to be startups, too personal to be platforms, and too useful to ignore.

Tiny tools for tiny problems.

A custom wrench. A little workflow prosthetic. A thing you build because your day has a pebble in its shoe.

Clobber is one of those. It is not trying to replace Webflow, WordPress, or a real CMS. Those tools solve larger and more important problems. Clobber is for the smaller, slightly ridiculous situation where you have a static HTML site and opening your code editor to change one word feels like overkill.

That is a narrow problem. But narrow problems are often the best ones to solve for yourself.

## Who Clobber is for

Clobber might be useful if you have a static landing page, a personal site, a portfolio, a tiny launch page, an internal microsite, or a side project that you built quickly and now want to keep tuning.

It is probably not for you if you need collaboration, permissions, version history, structured content, localization, approval flows, reusable blocks, or all the other things real CMSes are good at.

Those are real needs. Clobber is for a smaller one:

"I just want to change this sentence without turning it into a whole thing."

## Want to try it?

I'm making Clobber available for other people who have the same weird little itch.

**GitHub repo**
[github.com/savonge/clobber](https://github.com/savonge/clobber)

**Chrome extension**
[Chrome Web Store listing coming soon](#)

**Claude Code skill**
[Install the `/clobber` skill](#)

**How it works**
[Technical deep dive](#)

Clobber is MIT licensed. Give it a spin.
