import { useId, useState, type KeyboardEvent } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { normalizeTag, tagError } from '@/lib/tags';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { accentFor } from '@shared/accent';

/** How many suggestions are offered below the input. */
const MAX_SUGGESTIONS = 8;

/**
 * Edits a list of tags as removable chips, with an input that adds a tag on Enter or comma and suggestions taken from
 * the tags already used in the vault.
 * @param props - The input ID, the current tags, the vault's tags for suggestions, write permission and the change callback.
 */
export function TagInput({
  id,
  tags,
  suggestions,
  canWrite,
  onChange
}: {
  id?: string;
  tags: readonly string[];
  suggestions: readonly string[];
  canWrite: boolean;
  onChange: (tags: string[]) => void;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const query = draft.trim().toLowerCase();
  const offered = suggestions
    .filter(/**
     * Keeps suggestions that are not set yet and match the typed text.
     * @param tag - One tag of the vault.
     */ (tag) => !tags.some(/**
       * Compares with a set tag ignoring case.
       * @param set - One tag of the entry.
       */ (set) => set.toLowerCase() === tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)))
    .slice(0, MAX_SUGGESTIONS);

  /**
   * Adds a tag after validating it.
   * @param value - The tag to add.
   */
  function add(value: string) {
    const problem = tagError(value, tags);
    if (problem) {
      setError(value.trim() ? problem : null);
      return;
    }
    onChange([...tags, normalizeTag(value)]);
    setDraft('');
    setError(null);
  }

  /**
   * Adds the typed tag on Enter or comma instead of submitting the entry form.
   * @param event - The key event.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="grid gap-2">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map(/**
           * Renders one tag chip.
           * @param tag - One tag of the entry.
           */ (tag) => (
            <Badge key={tag} variant="outline" className={cn('h-6 gap-1 pe-1 text-xs', accentFor(tag).badge)}>
              {tag}
              {canWrite && (
                <button
                  type="button"
                  className="rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  aria-label={`Remove tag ${tag}`}
                  onClick={/** Removes this tag. */ () => onChange(tags.filter(/**
                   * Keeps the other tags.
                   * @param item - One tag.
                   */ (item) => item !== tag))}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      ) : !canWrite && <p className="text-sm text-muted-foreground">No tags.</p>}
      {canWrite && (
        <>
          <div className="flex gap-2">
            <Input
              id={id}
              value={draft}
              placeholder="Add a tag…"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={/**
               * Updates the typed tag.
               * @param event - The input change event.
               */ (event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
            />
            <Button type="button" variant="outline" size="icon" aria-label="Add tag" title="Add tag" disabled={!draft.trim()} onClick={/** Adds the typed tag. */ () => add(draft)}>
              <PlusIcon />
            </Button>
          </div>
          {error && <FieldError id={errorId}>{error}</FieldError>}
          {offered.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Suggested tags">
              <span className="text-xs text-muted-foreground">Suggestions:</span>
              {offered.map(/**
               * Renders one suggestion.
               * @param tag - A tag used elsewhere in the vault.
               */ (tag) => (
                <Button key={tag} type="button" variant="outline" size="xs" className="h-6 px-2 text-xs" onClick={/** Adds the suggested tag. */ () => add(tag)}>
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
