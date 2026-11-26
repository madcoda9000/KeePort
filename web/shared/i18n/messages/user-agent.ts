import { defineMessages } from '../core.ts';

/** Texts of the short client labels built from a user agent, e.g. "Firefox 120 on Linux". */
export default defineMessages({
  en: { browser: 'Browser', onSystem: '{client} on {system}' },
  de: { browser: 'Browser', onSystem: '{client} unter {system}' },
  fr: { browser: 'Navigateur', onSystem: '{client} sous {system}' }
});
