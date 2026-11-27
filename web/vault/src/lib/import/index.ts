import { parseBitwardenJson } from './bitwarden-json.ts';
import { parseCsvImport, type ParsedImport } from './formats.ts';
import messages from '../../i18n/lib-import.ts';
import { translate } from '../../../../shared/i18n/core.ts';

/**
 * Reads an import file: JSON files must be unencrypted Bitwarden exports, everything else is read as CSV.
 * @param text - The file content.
 */
export function parseImport(text: string): ParsedImport {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (!trimmed) throw new Error(translate(messages, 'noEntries'));
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseBitwardenJson(trimmed);
  return parseCsvImport(text);
}
