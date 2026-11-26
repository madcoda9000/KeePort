import { defineMessages } from '../../../shared/i18n/core.ts';

/** Texts of the custom field helpers: validation of new field names. */
export default defineMessages({
  en: {
    nameRequired: 'Enter a field name.',
    nameTooLong: 'Field names can have at most {max} characters.',
    standardField: '“{name}” is a standard field.',
    reserved: 'This name is reserved for KeePass apps.',
    duplicate: 'A field named “{name}” already exists.'
  },
  de: {
    nameRequired: 'Gib einen Feldnamen ein.',
    nameTooLong: 'Feldnamen dürfen höchstens {max} Zeichen lang sein.',
    standardField: '„{name}“ ist ein Standardfeld.',
    reserved: 'Dieser Name ist für KeePass-Apps reserviert.',
    duplicate: 'Es gibt bereits ein Feld namens „{name}“.'
  },
  fr: {
    nameRequired: 'Saisissez un nom de champ.',
    nameTooLong: 'Les noms de champ peuvent comporter au maximum {max} caractères.',
    standardField: '« {name} » est un champ standard.',
    reserved: 'Ce nom est réservé aux applications KeePass.',
    duplicate: 'Un champ nommé « {name} » existe déjà.'
  }
});
