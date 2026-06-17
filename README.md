# Github actions visual regression bot for [storybook](https://storybook.js.org/)

Check out this demo PR [#14](https://github.com/krystxf/storybook-stuff/pull/14) it says it all

## Features
- shows visual diff for changes
- can be approved by commenting `approve changes <component>`

## How does it work
It saves snapshots to separate branch so they can be shown in the comment. It's not clean but it doesn't need any separate storage configuration and it's basically free.
