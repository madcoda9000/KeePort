import { formatNumber } from '@shared/i18n/core';

/**
 * Formats a size in bytes, kilobytes or megabytes in the current language.
 * @param size - The size in bytes.
 */
export function formatSize(size: number) {
  if (size < 1024) return `${formatNumber(size)} B`;
  if (size < 1024 * 1024) return `${formatNumber(size / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(size / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}
