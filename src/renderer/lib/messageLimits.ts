// MeshCore caps an outgoing text message body at 132 characters. Lives here
// rather than in Composer so surfaces that only need the number (e.g. the
// quick bar's macro previews) don't pull in the whole composer tree.
export const MAX_MESSAGE_LENGTH = 132;
