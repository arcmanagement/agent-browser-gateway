# Android browser extension feasibility

Last reviewed: 2026-07-09

## Decision

ABG will not plan direct Android Chrome support until Google exposes a supported Chrome extension
surface on Android.

The Android mobile roadmap should instead track an Android Firefox feasibility spike first. Firefox
for Android has a documented mobile add-on path, while Android Chrome does not expose the normal
Chrome extension installation and runtime surface ABG depends on.

## Sources checked

- Google Chrome Web Store Help, "Install and manage extensions":
  https://support.google.com/chrome_webstore/answer/2664769
- Chrome Extensions documentation landing page:
  https://developer.chrome.com/docs/extensions
- Mozilla Add-ons Community Blog, "Open extensions on Firefox for Android debut December 14":
  https://blog.mozilla.org/addons/2023/11/28/open-extensions-on-firefox-for-android-debut-december-14-but-you-can-get-a-sneak-peek-today/
- Mozilla Android add-ons catalog:
  https://addons.mozilla.org/android/

## Findings

The Chrome Web Store Help article describes extension installation as a way to customize Chrome on
desktop. It does not document Android Chrome as an extension target, and Chrome's extension developer
documentation does not provide an Android Chrome runtime target equivalent to desktop Chrome.

ABG's current browser side is not just a content script. It depends on a browser extension runtime,
popup consent, long-lived local WebSocket messaging to the Gateway, `activeTab`, optional host
permissions for isolated all-tabs profiles, and Chrome-family debugger APIs for screenshots, input,
dialogs, downloads, PDFs, network inspection, and approved eval fallback. Without official Android
Chrome extension support, those consent and command paths cannot be made reliable or user-supportable.

Firefox for Android is the strongest alternative Android browser path because Mozilla opened Android
compatible extensions through AMO and documents Firefox for Android extension development. This does
not make ABG automatically compatible: ABG still needs a Firefox browser-adapter implementation,
mobile popup and permission validation, local Gateway pairing from phone to desktop or a phone-local
Gateway equivalent, and replacement behavior for Chrome DevTools Protocol features that Firefox does
not provide.

Chromium-based Android browsers that advertise Chrome extension compatibility, including Kiwi-style
paths, are not selected for the official ABG roadmap at this time. They may be useful for experiments,
but ABG should not make product commitments on an unofficial Android Chrome extension surface unless
the required popup, background, WebSocket, permission, and debugger behavior is verified against a
specific maintained browser release.

## Roadmap wording

Use this wording in roadmap surfaces:

> Android Chrome direct support is deferred until Google provides a supported Android extension
> surface. Android mobile feasibility will start with Firefox for Android because it has an official
> mobile add-on path; Chromium Android forks remain experimental unless a maintained browser proves
> the required ABG extension and debugger capabilities.

## Validation checklist

- Confirm this note cites the source used for the Android Chrome decision.
- Confirm the roadmap says Android Chrome direct support is deferred.
- Confirm the roadmap names Android Firefox as the first alternative browser feasibility path.
- Confirm Chromium Android forks are described as experimental rather than committed support.
