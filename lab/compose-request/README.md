# Request composer

The implementation lives in `lab/lib/compose.ts` and is exposed by `npm run argus -- compose`. It normalizes CRLF/lone CR to LF, strips per-line trailing whitespace, replaces the single `{{TASK}}`, appends one blank line and the track REQUIRED OUTPUT block, and adds a final newline. Pass an official block file as the optional fourth path when byte-for-byte portal reproduction is required.
