# Bugs

* Clicking notifications should take us to that part of the application. Right now clicking notifications only pulls up the app but doesn't take us to the message or contact or channel. Sending a message immediately scrolls it back down to the bottom correctly.
* New section scrolls up to the top and leaves a gap at the bottom. We should only scroll up as far as allows the scrollbar to go.
* Hop count and hash mode are not showing up on messages like the official app. These should show up next to the timestamp of the message.
* Trace path (trace packets) don't seem to be handled properly over the bridge. When the official client does a trace it always times out. When I connect to the radio directly from the official client and do the same trace it works fine. This is likely an issue with the bridge not properly handling trace packets.
* Theme settings ligh / dark have no effect. Should switch between our different light / dark themes if we force one.

# Next

* Implement contact purging in settings under Extra Tools. Two options, purge all, or keep favorites.
* Being able to right click paths to copy path as text or JSON. Being able to right click on hops in a path to copy prefix.
* Exxpand the notification API from https://www.electronjs.org/docs/latest/api/notification to include groupID, groupTitle, subtitle, hasREply, icon.
* Option to remember right panel expanded / collapsed state per context (DM, channel, settings, map, etc)
* Make the channel and unread messages share the same component and style so that our messaging views are consistent.
