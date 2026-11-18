// Bulgarian for the control panel: schools (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_SCHOOLS: AdminDict = {
  // Shared with the shell and other areas
  'Control panel': 'Контролен панел',
  'Administration': 'Администрация',
  'Back to administration': 'Обратно към администрацията',
  'Clear': 'Изчисти',
  'Search': 'Търсене',

  'School activity': 'Активност на школите',
  "We couldn't load the schools. Nothing was changed.": 'Школите не можаха да се заредят. Нищо не е променено.',
  'All listed': 'Всички публикувани',
  'Current': 'Актуална',
  'Awaiting confirmation': 'Чака потвърждение',
  'Hidden from the map': 'Скрита от картата',
  'listed': 'публикувани',
  'awaiting confirmation': 'чакат потвърждение',
  'hidden from the map': 'скрити от картата',
  'A listed school whose Sifu has not edited or confirmed it for 90 days awaits confirmation: the Sifu is asked, and the school stays on the map. From day 105 it is hidden from the public map and list until the Sifu confirms it. Nothing is deleted, and signing in does not count. New listings are decided in the':
    'Публикувана школа, която нейният Sifu не е редактирал или потвърдил 90 дни, чака потвърждение: Sifu получава запитване, а школата остава на картата. От 105-ия ден тя е скрита от публичната карта и списък, докато Sifu не я потвърди. Нищо не се изтрива, а влизането в акаунта не се брои. Новите школи се решават в',
  'review queue': 'опашката за преглед',
  'Filter by stage': 'Филтър по етап',
  'School, city or address': 'Школа, град или адрес',
  'hidden first, then awaiting, the longest without activity first': 'първо скритите, после чакащите, първо най-дълго без активност',
  'No listed school matches “{q}”. Check the spelling, or clear the search.': 'Няма публикувана школа, която да отговаря на „{q}“. Проверете изписването или изчистете търсенето.',
  'No listed school matches “{q}” in this stage. Check the spelling, or clear the search.':
    'Няма публикувана школа на този етап, която да отговаря на „{q}“. Проверете изписването или изчистете търсенето.',
  'No school is listed.': 'Няма публикувана школа.',
  'No listed school is in this stage: current.': 'Няма публикувана школа на този етап: актуална.',
  'No listed school is in this stage: awaiting confirmation.': 'Няма публикувана школа на този етап: чака потвърждение.',
  'No listed school is in this stage: hidden from the map.': 'Няма публикувана школа на този етап: скрита от картата.',
  'Listed schools, hidden first, then awaiting confirmation, the longest without activity first':
    'Публикувани школи, първо скритите, после чакащите потвърждение, първо най-дълго без активност',
  'School': 'Школа',
  'Activity': 'Активност',
  'Last edit or confirmation': 'Последна редакция или потвърждение',
  'Public map': 'Публична карта',
  'Listed by': 'Публикувана от',
  'Hidden from the map since {since} (asked on {asked})': 'Скрита от картата от {since} (запитване на {asked})',
  'Awaiting confirmation since {since}; hidden from about {from} without it': 'Чака потвърждение от {since}; без него се скрива около {from}',
  'On the public map': 'На публичната карта',
  'Not on the public map': 'Не е на публичната карта',
  'A Sifu': 'Sifu',
  'A record of the platform, not checked': 'Запис на платформата, непроверен',
  'Pages of schools': 'Страници с школи',
};
