import { defineMessages } from '../core.ts';

/** Texts of the shared data table: search, empty state and paging. */
export default defineMessages({
  en: {
    noMatches: 'No results match your search.',
    showing: 'Showing {from}–{to} of {total}',
    noResults: '0 results',
    rowsPerPage: 'Rows per page',
    pageOf: 'Page {page} of {pages}',
    previousPage: 'Previous page',
    nextPage: 'Next page'
  },
  de: {
    noMatches: 'Keine Treffer für deine Suche.',
    showing: '{from}–{to} von {total}',
    noResults: '0 Ergebnisse',
    rowsPerPage: 'Zeilen pro Seite',
    pageOf: 'Seite {page} von {pages}',
    previousPage: 'Vorherige Seite',
    nextPage: 'Nächste Seite'
  },
  fr: {
    noMatches: 'Aucun résultat ne correspond à votre recherche.',
    showing: '{from}–{to} sur {total}',
    noResults: '0 résultat',
    rowsPerPage: 'Lignes par page',
    pageOf: 'Page {page} sur {pages}',
    previousPage: 'Page précédente',
    nextPage: 'Page suivante'
  }
});
