import { useId, useState, type FormEvent } from 'react';
import { CopyIcon, EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { CustomField, TemplateInfo } from '@/lib/fields';
import { customFieldNameError } from '@/lib/fields';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import messages from '@/i18n/entry-fields';
import { useT } from '@shared/i18n/react';

interface EntryFieldsProps {
  fields: readonly CustomField[];
  /** The template the entry uses; it provides labels and the order of its fields. */
  template: TemplateInfo | null;
  canWrite: boolean;
  disabled: boolean;
  onChange: (fields: CustomField[]) => void;
  onCopy: (value: string, label: string) => void;
}

/**
 * Orders custom fields: fields defined by the template in template order first, then the others by name.
 * @param fields - The entry's custom fields.
 * @param template - The entry's template, or null.
 */
function orderFields(fields: readonly CustomField[], template: TemplateInfo | null) {
  const positions = new Map(template?.fields.map(/**
   * Maps a template field to its position.
   * @param field - One template field.
   * @param index - Its index in the ordered template fields.
   */ (field, index) => [field.name, index]) ?? []);
  return [...fields].sort(/**
   * Sorts template fields by position before all others.
   * @param a - The first field.
   * @param b - The second field.
   */ (a, b) => (positions.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.name) ?? Number.MAX_SAFE_INTEGER)
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Shows, edits, adds and removes the custom fields of an entry, e.g. the card number and CVV of a KeePass2Android
 * credit card. Protected fields are masked until revealed.
 * @param props - The fields, the template, write permission, the busy state and the change and copy callbacks.
 */
export function EntryFields({ fields, template, canWrite, disabled, onChange, onCopy }: EntryFieldsProps) {
  const baseId = useId();
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const ordered = orderFields(fields, template);
  const editable = canWrite && !disabled;
  const t = useT(messages);

  /**
   * Replaces the value of one field.
   * @param name - The field to change.
   * @param value - The new value.
   */
  function setValue(name: string, value: string) {
    onChange(fields.map(/**
     * Updates the matching field.
     * @param field - One custom field.
     */ (field) => (field.name === name ? { ...field, value } : field)));
  }

  /**
   * Shows or hides the value of a protected field.
   * @param name - The field to toggle.
   */
  function toggleReveal(name: string) {
    /**
     * Builds the new set of revealed fields.
     * @param current - The currently revealed field names.
     */
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!ordered.length && !canWrite) return null;
  return (
    <section className="grid gap-4" aria-label={t('additionalFields')}>
      <h3 className="text-sm font-semibold">{template ? t('templateFields', { template: template.title }) : t('additionalFields')}</h3>
      {!ordered.length && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {ordered.map(/**
       * Renders one custom field with copy, reveal and remove actions.
       * @param field - The field to render.
       * @param index - Its position in the form, used for a stable input ID.
       */ (field, index) => {
        const id = `${baseId}-field-${index}`;
        const label = template?.fields.find(/**
         * Finds the template definition of the field.
         * @param item - One template field.
         */ (item) => item.name === field.name)?.title ?? field.name;
        const fromTemplate = template?.fields.some(/**
         * Checks whether the template defines the field.
         * @param item - One template field.
         */ (item) => item.name === field.name) ?? false;
        const shown = !field.protected || revealed.has(field.name);
        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id={id}
                type={shown ? 'text' : 'password'}
                autoComplete="off"
                value={field.value}
                readOnly={!editable}
                onChange={/**
                 * Updates the field value in the draft.
                 * @param event - The input change event.
                 */ (event) => setValue(field.name, event.target.value)}
              />
              {field.protected && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={shown ? t('hideNamed', { label }) : t('showNamed', { label })}
                  title={shown ? t('hide') : t('show')}
                  onClick={/** Toggles the visibility of the protected value. */ () => toggleReveal(field.name)}
                >
                  {shown ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('copyNamed', { label })}
                title={t('copy')}
                disabled={!field.value}
                onClick={/** Copies the field value. */ () => onCopy(field.value, label)}
              >
                <CopyIcon />
              </Button>
              {editable && !fromTemplate && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('removeNamed', { label })}
                  title={t('removeField')}
                  onClick={/** Removes the field from the draft. */ () => onChange(fields.filter(/**
                   * Keeps all other fields.
                   * @param item - One custom field.
                   */ (item) => item.name !== field.name))}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
          </Field>
        );
      })}
      {editable && (adding ? (
        <AddFieldForm
          existing={fields.map(/**
           * Selects the field name.
           * @param field - One custom field.
           */ (field) => field.name)}
          onAdd={/**
           * Appends the new field and closes the form.
           * @param field - The new custom field.
           */ (field) => {
            onChange([...fields, field]);
            setAdding(false);
          }}
          onCancel={/** Closes the form without adding a field. */ () => setAdding(false)}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={/** Opens the form for a new field. */ () => setAdding(true)}>
          <PlusIcon /> {t('addField')}
        </Button>
      ))}
    </section>
  );
}

/**
 * Asks for the name, value and protection of a new custom field.
 * @param props - The names already in use and the callbacks to add or cancel.
 */
function AddFieldForm({
  existing,
  onAdd,
  onCancel
}: {
  existing: readonly string[];
  onAdd: (field: CustomField) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [isProtected, setIsProtected] = useState(false);
  const [touched, setTouched] = useState(false);
  const error = customFieldNameError(name, existing);
  const t = useT(messages);

  /**
   * Adds the field when the name is valid. The entry form is a separate form, so this one only handles the click.
   * @param event - The click or key event.
   */
  function add(event: Pick<FormEvent, 'preventDefault'>) {
    event.preventDefault();
    setTouched(true);
    if (!error) onAdd({ name: name.trim(), value, protected: isProtected });
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3" role="group" aria-label={t('newField')}>
      <Field data-invalid={touched && error ? true : undefined}>
        <FieldLabel htmlFor={`${baseId}-name`}>{t('fieldName')}</FieldLabel>
        <Input
          id={`${baseId}-name`}
          autoFocus
          autoComplete="off"
          value={name}
          aria-invalid={touched && error ? true : undefined}
          onChange={/**
           * Updates the name draft.
           * @param event - The input change event.
           */ (event) => {
            setName(event.target.value);
            setTouched(true);
          }}
          onKeyDown={/**
           * Adds the field on Enter instead of submitting the entry form.
           * @param event - The key event.
           */ (event) => {
            if (event.key === 'Enter') add(event);
          }}
        />
        {touched && error && <FieldError>{error}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${baseId}-value`}>{t('value')}</FieldLabel>
        <Input
          id={`${baseId}-value`}
          type={isProtected ? 'password' : 'text'}
          autoComplete="off"
          value={value}
          onChange={/**
           * Updates the value draft.
           * @param event - The input change event.
           */ (event) => setValue(event.target.value)}
          onKeyDown={/**
           * Adds the field on Enter instead of submitting the entry form.
           * @param event - The key event.
           */ (event) => {
            if (event.key === 'Enter') add(event);
          }}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${baseId}-protected`}
          checked={isProtected}
          onCheckedChange={/**
           * Sets whether the value is stored protected, like a password.
           * @param checked - The new checkbox state.
           */ (checked) => setIsProtected(checked === true)}
        />
        <Label htmlFor={`${baseId}-protected`} className="font-normal">{t('protected')}</Label>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={add}>{t('addField')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  );
}
