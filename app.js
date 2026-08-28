'use strict';
/* ============================================================================
   PLANER — app.js
   A powerful to-do app: multiple lists, subtasks, reminders, recurrence,
   drag & drop, themes, dual Gregorian + Jalali calendars, EN/FA localization.
   Data persists in localStorage. No dependencies.
   ============================================================================ */

/* ===================== 1. Utilities ===================== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape user text for safe HTML interpolation. */
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const pad2 = n => String(n).padStart(2, '0');
const clampN = (n, a, b) => Math.min(b, Math.max(a, n));

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

/* ===================== 2. Jalali Calendar =====================
   Port of the well-known jalaali-js algorithm (Behrang Norouzinia), plain JS.
   Accurate for the 1178..3178 Jalali year range covered by the 33-year cycle
   break table below. */
function jalDiv(a, b) { return ~~(a / b); }
function jalMod(a, b) { return a - ~~(a / b) * b; }

const JAL_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

/** Jalali leap-year info + Gregorian date of Jalali March (Nowruz) start. */
function jalCal(jy) {
  const bl = JAL_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14, jp = JAL_BREAKS[0], jm, jump = 0;
  if (jy < jp || jy >= JAL_BREAKS[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
  for (let i = 1; i < bl; i += 1) {
    jm = JAL_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + jalDiv(jump, 33) * 8 + jalDiv(jalMod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + jalDiv(n, 33) * 8 + jalDiv(jalMod(n, 33) + 3, 4);
  if (jalMod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = jalDiv(gy, 4) - jalDiv((jalDiv(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + jalDiv(jump + 4, 33) * 33;
  let leap = jalMod(jalMod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Jalali date -> Julian Day Number. */
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - jalDiv(jm, 7) * (jm - 7) + jd - 1;
}

/** Julian Day Number -> Jalali date. */
function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f, jm, jd;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + jalDiv(k, 31); jd = jalMod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + jalDiv(k, 30);
  jd = jalMod(k, 30) + 1;
  return { jy, jm, jd };
}

/** Gregorian date -> Julian Day Number. */
function g2d(gy, gm, gd) {
  let d = jalDiv((gy + jalDiv(gm - 8, 6) + 100100) * 1461, 4)
        + jalDiv(153 * jalMod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - jalDiv(jalDiv(gy + 100100 + jalDiv(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Julian Day Number -> Gregorian date. */
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + jalDiv(jalDiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = jalDiv(jalMod(j, 1461), 4) * 5 + 308;
  const gd = jalDiv(jalMod(i, 153), 5) + 1;
  const gm = jalMod(jalDiv(i, 153), 12) + 1;
  const gy = jalDiv(j, 1461) - 100100 + jalDiv(8 - gm, 6);
  return { gy, gm, gd };
}

/** Friendly wrappers */
function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
function isJalaliLeap(jy) { return jalCal(jy).leap === 0; }
/** Length of a Jalali month (1-12). */
function jMonthLen(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}
function gMonthLen(gy, gm) { return new Date(Date.UTC(gy, gm, 0)).getUTCDate(); }

/* ===================== 3. Date Helpers ===================== */
const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return { gy: y, gm: m, gd: d }; };
const isoOf = dt => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
const isoFromG = (gy, gm, gd) => `${gy}-${pad2(gm)}-${pad2(gd)}`;

/** Today's local date as ISO (gregorian). */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Weekday of an ISO date, 0=Sunday … 6=Saturday. */
function weekdayOf(iso) { const g = parseISO(iso); return new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); }
function addDaysISO(iso, n) {
  const g = parseISO(iso);
  return isoOf(new Date(Date.UTC(g.gy, g.gm - 1, g.gd + n)));
}
/** Add months keeping day-of-month clamped to target length. */
function addMonthsISO(iso, n) {
  const g = parseISO(iso);
  const t = (g.gy * 12 + (g.gm - 1)) + n;
  const y2 = Math.floor(t / 12), m2 = t % 12 + 1;
  const d2 = Math.min(g.gd, gMonthLen(y2, m2));
  return isoFromG(y2, m2, d2);
}
function addYearsISO(iso, n) {
  const g = parseISO(iso);
  const y2 = g.gy + n;
  return isoFromG(y2, g.gm, Math.min(g.gd, gMonthLen(y2, g.gm)));
}
/** Days between two ISO dates (toIso - fromIso), DST-safe via UTC. */
function diffDays(fromIso, toIso) {
  const a = parseISO(fromIso), b = parseISO(toIso);
  return Math.round((Date.UTC(b.gy, b.gm - 1, b.gd) - Date.UTC(a.gy, a.gm - 1, a.gd)) / 86400000);
}
/** ISO gregorian -> {jy,jm,jd} */
function jPart(iso) { const g = parseISO(iso); return toJalali(g.gy, g.gm, g.gd); }
/** {jy,jm,jd} -> ISO gregorian */
function isoFromJ(jy, jm, jd) { const g = toGregorian(jy, jm, jd); return isoFromG(g.gy, g.gm, g.gd); }

// --- marker used by the offline unit test; everything above is DOM-free ---
//@state-marker

/* ===================== 4. Localization ===================== */
const STRINGS = {
  en: {
    'app.name': 'Planer',
    'nav.myday': 'My Day', 'nav.important': 'Important', 'nav.planned': 'Planned', 'nav.tasks': 'Tasks',
    'sec.lists': 'Lists', 'btn.newList': 'New list', 'ph.newList': 'List name',
    'btn.add': 'Add', 'btn.cancel': 'Cancel', 'cf.delete': 'Delete', 'undo': 'Undo',
    'ph.search': 'Search tasks…', 'tt.clearSearch': 'Clear search',
    'tt.menu': 'Menu', 'tt.settings': 'Settings', 'tt.mode': 'Light / dark', 'tt.lang': 'Language', 'tt.shortcuts': 'Keyboard shortcuts',
    'set.theme': 'Theme', 'set.mode': 'Appearance', 'set.lang': 'Language', 'set.cal': 'Primary calendar',
    'theme.aurora': 'Aurora Glass', 'theme.paper': 'Minimal Paper', 'theme.neon': 'Neon Cyber', 'theme.forest': 'Forest',
    'theme.ocean': 'Ocean', 'theme.sunset': 'Sunset', 'theme.slate': 'Slate', 'theme.lavender': 'Lavender',
    'mode.light': 'Light', 'mode.dark': 'Dark', 'cal.greg': 'Gregorian', 'cal.jal': 'Jalali',
    'sc.title': 'Keyboard shortcuts', 'sc.new': 'New task', 'sc.search': 'Search', 'sc.panel': 'This panel', 'sc.esc': 'Close / cancel',
    'tt.close': 'Close', 'tt.closeDrawer': 'Close details', 'tt.dStar': 'Mark important', 'tt.dMyday': 'Add to My Day', 'tt.dDelete': 'Delete task',
    'tt.rowStar': 'Important', 'tt.rowDel': 'Delete', 'tt.drag': 'Drag to reorder',
    'sec.steps': 'Steps', 'ph.step': 'Add step', 'lbl.due': 'Due date', 'lbl.reminder': 'Reminder',
    'lbl.repeat': 'Repeat', 'lbl.list': 'List', 'lbl.days': 'days', 'ph.notes': 'Add notes', 'ph.title': 'Task title',
    'ph.addTask': 'Add a task', 'ph.myDay': 'Add a task to My Day',
    'comp.title': 'Completed', 'comp.clear': 'Clear completed',
    'tt.details': 'Task details', 'tt.pickDate': 'Pick a date',
    'pk.clear': 'None', 'pk.yesterday': 'Yesterday', 'pk.today': 'Today', 'pk.tomorrow': 'Tomorrow',
    'greet.morning': 'Good morning!', 'greet.afternoon': 'Good afternoon!', 'greet.evening': 'Good evening!',
    'empty.myday': 'Nothing planned — enjoy your day', 'empty.list': 'No tasks here yet', 'empty.important': 'No important tasks',
    'empty.planned': 'Nothing scheduled', 'empty.search': 'No results found',
    'empty.sub.myday': 'Add a task below or press N', 'empty.sub.list': 'Add one below or press N',
    'empty.sub.search': 'Try a different search',
    'cnt.tasks': '{n} task{s}', 'stats.done': '{a} of {b} done',
    'comp.done': '{n} completed today', 'chip.overdue': 'Overdue', 'chip.today': 'Today', 'chip.tomorrow': 'Tomorrow',
    'rep.none': 'Never', 'rep.daily': 'Daily', 'rep.weekly': 'Weekly', 'rep.monthly': 'Monthly', 'rep.yearly': 'Yearly', 'rep.custom': 'Custom…',
    'every.days': 'Every {n} days', 'toast.repeated': 'Next occurrence: {date}',
    'toast.deleted': 'Task deleted', 'toast.moved': 'Moved to {list}', 'toast.listDeleted': 'List deleted — tasks moved to Tasks',
    'toast.reminder': 'Reminder: {title}',
    'cf.list.title': 'Delete this list?', 'cf.list.body': '“{name}” will be removed. Its tasks move to Tasks.',
    'created.on': 'Created {date}', 'results.for': '{n} result{s} for “{q}”',
    'ring.tip': '{p}% done', 'tip.star': 'Starred',
    'a.complete': 'Mark complete', 'a.star': 'Mark important', 'a.delete': 'Delete', 'a.drag': 'Drag to reorder',
    'a.listMenu': 'List options', 'a.toggleStep': 'Toggle step', 'a.stepDel': 'Delete step', 'a.rename': 'Rename',
    'a.prevMonth': 'Previous month', 'a.nextMonth': 'Next month', 'a.interval': 'Interval in days',
    'lbl.time': 'Time', 'list.delete': 'Delete list', 'side.empty': 'No lists yet',
    'lbl.priority': 'Priority', 'lbl.tags': 'Tags', 'lbl.attachments': 'Attachments', 'lbl.dependencies': 'Dependencies',
    'lbl.blocked': 'Blocked', 'lbl.blockedBy': 'Blocked by', 'lbl.blocks': 'Blocks',
    'pri.none': 'None', 'pri.low': 'Low', 'pri.medium': 'Medium', 'pri.high': 'High',
    'sec.attachments': 'Attachments', 'sec.dependencies': 'Dependencies',
    'btn.addFile': 'Add file', 'btn.addTag': 'Add tag', 'btn.forceComplete': 'Force complete',
    'ph.pickDate': 'Pick a date', 'ph.addReminder': 'Add reminder',
    'ph.newTag': 'New tag...', 'ph.selectTask': 'Select a task...',
    'tag.create': 'Create tag "{name}"', 'tag.delete': 'Delete tag',
    'dep.added': 'Dependency added', 'dep.removed': 'Dependency removed',
    'dep.blocked': 'This task is blocked by: {tasks}', 'dep.cannotComplete': 'Cannot complete — blocked by {tasks}',
    'attach.tooLarge': 'File too large (max 2MB)', 'attach.added': 'File attached', 'attach.removed': 'File removed',
    'nav.calendar': 'Calendar', 'ph.onDay': 'Add a task on {d}',
    'cal.inMonth': '{n} task{s} this month', 'cal.noDay': 'No tasks on this day', 'cal.more': '+{n} more',
    'days.left': '{n} days left', 'days.late': '{n} days late',
    'streak.days': '{n}-day streak', 'momentum.title': 'Momentum',
    'mom.best': 'Best streak', 'mom.total': 'Completed',
    'rescue.title': '{n} overdue task{s}', 'rescue.move': 'Move to today',
    'ach.unlocked': 'Achievement unlocked', 'ach.shelf': 'Achievements', 'ach.locked': 'Locked',
    'set.accent': 'Accent color', 'accent.default': 'Theme default',
    'tt.sound': 'Sound effects', 'mode.auto': 'Auto',
    'set.backup': 'Backup', 'set.export': 'Export JSON', 'set.import': 'Import',
    'set.install': 'Install app', 'set.installed': 'Planer was installed', 'set.aiKey': 'AI Assistant',
    'toast.importFail': 'Invalid backup file',
    'cf.import.title': 'Restore backup?', 'cf.import.body': 'Current data will be replaced with the backup file.',
    'bg.title': 'Choose Background', 'bg.upload': 'Upload Photo', 'bg.clear': 'Remove Background', 'bg.set': 'Background set', 'bg.removed': 'Background removed',
    'suggest.title': 'Suggestions', 'suggest.empty': 'No suggestions right now', 'suggest.overdue': 'Overdue', 'suggest.important': 'Important', 'suggest.old': 'Aging tasks',
    'group.new': 'New group', 'group.rename': 'Rename group', 'group.delete': 'Delete group', 'group.ungrouped': 'Ungrouped',
    'list.print': 'Print list',
    'group.none': 'No grouping', 'group.priority': 'Priority', 'group.list': 'List', 'group.due': 'Due date',
    'grp.high': 'High Priority', 'grp.medium': 'Medium Priority', 'grp.low': 'Low Priority', 'grp.none': 'No Priority',
    'group.week': 'This Week', 'group.later': 'Later', 'group.noDate': 'No Date',
    'auth.signIn': 'Sign in with Google', 'auth.signOut': 'Sign out', 'auth.welcome': 'Welcome, {name}!',
    'auth.signedOut': 'Signed out', 'auth.error': 'Sign-in failed', 'auth.synced': 'All changes synced',
    'auth.syncError': 'Sync failed', 'auth.signOutConfirm': 'Sign out from Planer?',
    'auth.account': 'Account', 'auth.guestMsg': 'Sign in to sync your tasks across all your devices.',
    'auth.syncNow': 'Sync Now', 'auth.syncing': 'Syncing...',
    'ph.addTask': 'Add a task', 'pk.laterToday': 'Later today', 'pk.pickDateTime': 'Pick a date & time', 'lbl.every': 'Every',
    'cmd.placeholder': 'Jump to… or type to search', 'cmd.empty': 'No matches',
    'bulk.sel': '{n} selected', 'bulk.complete': 'Complete', 'bulk.delete': 'Delete', 'bulk.cancel': 'Cancel',
    'chat.title': 'AI Assistant', 'chat.welcome': "Hi! I'm your AI assistant. Ask me anything — about Planer, your tasks, or anything else.", 'chat.placeholder': 'Ask me anything...', 'chat.aria': 'AI Assistant', 'chat.setupTitle': 'Set up your AI', 'chat.setupBody': 'Enter your Google Gemini API key to enable the AI assistant.', 'chat.cancel': 'Cancel', 'chat.save': 'Save', 'chat.thinking': 'Thinking...',     'chat.error': 'Something went wrong. Check your API key and try again.', 'chat.noKey': 'Please set your Gemini API key first.',
    'chat.apiKey': 'API Key', 'chat.baseUrl': 'Base URL', 'chat.baseUrlHint': '(leave empty for Google Gemini)', 'chat.model': 'Model', 'chat.modelHint': '(optional)',
    'chat.webSearch': 'Web search', 'chat.webSearchHint': 'Search the web for context',
    'chat.tavilyKey': 'Tavily API Key', 'chat.tavilyHint': '(free at tavily.com — 1000 searches/month)', 'chat.tavilyRequired': 'Web search requires a Tavily API key.',
    'chat.actionTitle': 'Confirm Actions', 'chat.actionSubtitle': 'Review and approve changes before they\'re applied',
    'chat.actionApprove': 'Approve All', 'chat.actionReject': 'Reject All', 'chat.actionEdit': 'Edit', 'chat.actionRemove': 'Remove',
    'chat.actionCreate': 'Create task', 'chat.actionEditTask': 'Edit task', 'chat.actionDelete': 'Delete task',
    'chat.actionComplete': 'Complete task', 'chat.actionStar': 'Star task', 'chat.actionAddList': 'Add list', 'chat.actionDeleteList': 'Delete list',
    'chat.action.none': 'No actions to confirm',
    'sc.palette': 'Command palette',
    'sc.nl': 'Quick add understands “tomorrow 5pm !important #work” — dates, times, importance, lists and repeats.',
    'pk.nextweek': 'Next week',
    'tpl.work': 'Work', 'tpl.personal': 'Personal', 'tpl.shopping': 'Shopping',
    'tpl.study': 'Study', 'tpl.fitness': 'Fitness', 'tpl.travel': 'Travel',
    'lbl.icon': 'Icon', 'tt.options': 'Composer options', 'cx.auto': 'Auto (this view)',
    'sort.label': 'Sort', 'sort.manual': 'Manual order', 'sort.due': 'By due date',
    'sort.alpha': 'Alphabetical', 'sort.imp': 'By importance', 'sort.created': 'Newest first',
    'cx.when': 'When', 'cx.alert': 'Remind me', 'cx.place': 'Add to', 'cx.reset': 'Reset options',
    'dg.schedule': 'Scheduling', 'dg.organize': 'Organization', 'nl.start': 'Start from a template',
  },
  fa: {
    'app.name': 'پلنر',
    'nav.myday': 'روز من', 'nav.important': 'مهم', 'nav.planned': 'برنامه‌ریزی‌شده', 'nav.tasks': 'کارها',
    'sec.lists': 'لیست‌ها', 'btn.newList': 'لیست جدید', 'ph.newList': 'نام لیست',
    'btn.add': 'افزودن', 'btn.cancel': 'انصراف', 'cf.delete': 'حذف', 'undo': 'بازگردانی',
    'ph.search': 'جستجوی کارها…', 'tt.clearSearch': 'پاک کردن جستجو',
    'tt.menu': 'منو', 'tt.settings': 'تنظیمات', 'tt.mode': 'روشن / تیره', 'tt.lang': 'زبان', 'tt.shortcuts': 'میانبرهای صفحه‌کلید',
    'set.theme': 'پوسته', 'set.mode': 'ظاهر', 'set.lang': 'زبان', 'set.cal': 'تقویم اصلی',
    'theme.aurora': 'شیشه قطبی', 'theme.paper': 'کاغذ مینیمال', 'theme.neon': 'نئون سایبری', 'theme.forest': 'جنگل',
    'theme.ocean': 'اقیانوس', 'theme.sunset': 'غروب', 'theme.slate': 'سنگ‌برگ', 'theme.lavender': 'لاوندر',
    'mode.light': 'روشن', 'mode.dark': 'تیره', 'cal.greg': 'میلادی', 'cal.jal': 'شمسی',
    'sc.title': 'میانبرهای صفحه‌کلید', 'sc.new': 'کار جدید', 'sc.search': 'جستجو', 'sc.panel': 'همین پنجره', 'sc.esc': 'بستن / انصراف',
    'tt.close': 'بستن', 'tt.closeDrawer': 'بستن جزئیات', 'tt.dStar': 'مهم کردن', 'tt.dMyday': 'افزودن به روز من', 'tt.dDelete': 'حذف کار',
    'tt.rowStar': 'مهم', 'tt.rowDel': 'حذف', 'tt.drag': 'برای جابه‌جایی بکشید',
    'sec.steps': 'مرحله‌ها', 'ph.step': 'افزودن مرحله', 'lbl.due': 'تاریخ سررسید', 'lbl.reminder': 'یادآور',
    'lbl.repeat': 'تکرار', 'lbl.list': 'لیست', 'lbl.days': 'روز', 'ph.notes': 'افزودن یادداشت', 'ph.title': 'عنوان کار',
    'ph.addTask': 'افزودن کار', 'ph.myDay': 'افزودن کار به روز من',
    'comp.title': 'تکمیل‌شده', 'comp.clear': 'پاک کردن تکمیل‌شده‌ها',
    'tt.details': 'جزئیات کار', 'tt.pickDate': 'انتخاب تاریخ',
    'pk.clear': 'بدون تاریخ', 'pk.yesterday': 'دیروز', 'pk.today': 'امروز', 'pk.tomorrow': 'فردا',
    'greet.morning': 'صبح بخیر!', 'greet.afternoon': 'عصر بخیر!', 'greet.evening': 'شب بخیر!',
    'empty.myday': 'برای امروز چیزی نیست — لذت ببر', 'empty.list': 'هنوز کاری اینجا نیست', 'empty.important': 'کاری مهم نیست',
    'empty.planned': 'چیزی برنامه‌ریزی نشده', 'empty.search': 'نتیجه‌ای پیدا نشد',
    'empty.sub.myday': 'کار جدید را پایین اضافه کنید یا N بزنید', 'empty.sub.list': 'از پایین اضافه کنید یا N بزنید',
    'empty.sub.search': 'جستجوی دیگری امتحان کنید',
    'cnt.tasks': '{n} کار', 'stats.done': '{a} از {b} انجام شد',
    'comp.done': '{n} تکمیل‌شده', 'chip.overdue': 'گذشته', 'chip.today': 'امروز', 'chip.tomorrow': 'فردا',
    'rep.none': 'هرگز', 'rep.daily': 'روزانه', 'rep.weekly': 'هفتگی', 'rep.monthly': 'ماهانه', 'rep.yearly': 'سالانه', 'rep.custom': 'سفارشی…',
    'every.days': 'هر {n} روز', 'toast.repeated': 'تکرار بعدی: {date}',
    'toast.deleted': 'کار حذف شد', 'toast.moved': 'به {list} منتقل شد', 'toast.listDeleted': 'لیست حذف شد — کارها به «کارها» منتقل شدند',
    'toast.reminder': 'یادآور: {title}',
    'cf.list.title': 'این لیست حذف شود؟', 'cf.list.body': '«{name}» حذف می‌شود و کارهایش به «کارها» منتقل می‌شوند.',
    'created.on': 'ایجاد {date}', 'results.for': '{n} نتیجه برای «{q}»',
    'ring.tip': '٪{p} انجام شد', 'tip.star': 'ستاره‌دار',
    'a.complete': 'تکمیل کار', 'a.star': 'مهم کردن', 'a.delete': 'حذف', 'a.drag': 'برای جابه‌جایی بکشید',
    'a.listMenu': 'گزینه‌های لیست', 'a.toggleStep': 'انجام مرحله', 'a.stepDel': 'حذف مرحله', 'a.rename': 'تغییر نام',
    'a.prevMonth': 'ماه قبل', 'a.nextMonth': 'ماه بعد', 'a.interval': 'فاصله به روز',
    'lbl.time': 'ساعت', 'list.delete': 'حذف لیست', 'side.empty': 'هنوز لیستی ساخته نشده',
    'lbl.priority': 'اولویت', 'lbl.tags': 'برچسب‌ها', 'lbl.attachments': 'پیوست‌ها', 'lbl.dependencies': 'وابستگی‌ها',
    'lbl.blocked': 'قفل شده', 'lbl.blockedBy': 'قفل شده توسط', 'lbl.blocks': 'قفل می‌کند',
    'pri.none': 'ندارد', 'pri.low': 'پایین', 'pri.medium': 'متوسط', 'pri.high': 'بالا',
    'sec.attachments': 'پیوست‌ها', 'sec.dependencies': 'وابستگی‌ها',
    'btn.addFile': 'افزودن فایل', 'btn.addTag': 'افزودن برچسب', 'btn.forceComplete': 'انجام اجباری',
    'ph.pickDate': 'انتخاب تاریخ', 'ph.addReminder': 'افزودن یادآور',
    'ph.newTag': 'برچسب جدید...', 'ph.selectTask': 'یک کار انتخاب کنید...',
    'tag.create': 'ساختن برچسب «{name}»', 'tag.delete': 'حذف برچسب',
    'dep.added': 'وابستگی اضافه شد', 'dep.removed': 'وابستگی حذف شد',
    'dep.blocked': 'این کار قفل شده توسط: {tasks}', 'dep.cannotComplete': 'قابل انجام نیست — قفل شده توسط {tasks}',
    'attach.tooLarge': 'فایل بیش از حد بزرگ است (حداکثر ۲ مگابایت)', 'attach.added': 'فایل پیوست شد', 'attach.removed': 'فایل حذف شد',
    'nav.calendar': 'تقویم', 'ph.onDay': 'افزودن کار برای {d}',
    'cal.inMonth': '{n} کار در این ماه', 'cal.noDay': 'این روز کاری نیست', 'cal.more': '+{n} مورد دیگر',
    'days.left': '{n} روز مانده', 'days.late': '{n} روز تأخیر',
    'streak.days': 'زنجیرهٔ {n} روزه', 'momentum.title': 'پیشرفت من',
    'mom.best': 'بهترین زنجیره', 'mom.total': 'تکمیل‌شده',
    'rescue.title': '{n} کار عقب‌افتاده', 'rescue.move': 'انتقال به امروز',
    'ach.unlocked': 'دستاورد باز شد', 'ach.shelf': 'دستاوردها', 'ach.locked': 'قفل',
    'set.accent': 'رنگ تأکیدی', 'accent.default': 'پیش‌فرض پوسته',
    'tt.sound': 'جلوه‌های صوتی', 'mode.auto': 'خودکار',
    'set.backup': 'پشتیبان‌گیری', 'set.export': 'خروجی JSON', 'set.import': 'بازیابی',
    'set.install': 'نصب برنامه', 'set.installed': 'پلنر نصب شد', 'set.aiKey': 'دستیار هوش مصنوعی',
    'toast.importFail': 'فایل پشتیبان نامعتبر است',
    'cf.import.title': 'بازیابی پشتیبان؟', 'cf.import.body': 'داده‌های فعلی با محتوای فایل پشتیبان جایگزین می‌شود.',
    'bg.title': 'انتخاب پس‌زمینه', 'bg.upload': 'آپلود عکس', 'bg.clear': 'حذف پس‌زمینه', 'bg.set': 'پس‌زمینه اعمال شد', 'bg.removed': 'پس‌زمینه حذف شد',
    'suggest.title': 'پیشنهادها', 'suggest.empty': 'الان پیشنهادی نیست', 'suggest.overdue': 'عقب‌افتاده', 'suggest.important': 'مهم', 'suggest.old': 'کارهای قدیمی',
    'group.new': 'گروه جدید', 'group.rename': 'تغییر نام گروه', 'group.delete': 'حذف گروه', 'group.ungrouped': 'بدون گروه',
    'list.print': 'چاپ لیست',
    'group.none': 'بدون دسته‌بندی', 'group.priority': 'اولویت', 'group.list': 'لیست', 'group.due': 'تاریخ سررسید',
    'grp.high': 'اولویت بالا', 'grp.medium': 'اولویت متوسط', 'grp.low': 'اولویت پایین', 'grp.none': 'بدون اولویت',
    'group.week': 'این هفته', 'group.later': 'بعداً', 'group.noDate': 'بدون تاریخ',
    'auth.signIn': 'ورود با گوگل', 'auth.signOut': 'خروج', 'auth.welcome': '{name} خوش آمدید!',
    'auth.signedOut': 'خارج شدید', 'auth.error': 'خطا در ورود', 'auth.synced': 'تمام تغییرات همگام شد',
    'auth.syncError': 'همگام‌سازی ناموفق بود', 'auth.signOutConfirm': 'از پلنر خارج شوید؟',
    'auth.account': 'حساب کاربری', 'auth.guestMsg': 'برای همگام‌سازی کارها در تمام دستگاه‌ها وارد شوید.',
    'auth.syncNow': 'همگام‌سازی فوری', 'auth.syncing': 'در حال همگام‌سازی...',
    'ph.addTask': 'افزودن کار', 'pk.laterToday': 'امروز عصر', 'pk.pickDateTime': 'انتخاب تاریخ و ساعت', 'lbl.every': 'هر',
    'cmd.placeholder': 'پرش به… یا برای جستجو تایپ کنید', 'cmd.empty': 'موردی پیدا نشد',
    'bulk.sel': '{n} مورد انتخاب شده', 'bulk.complete': 'انجام', 'bulk.delete': 'حذف', 'bulk.cancel': 'انصراف',
    'chat.title': 'دستیار هوش مصنوعی', 'chat.welcome': 'سلام! من دستیار هوش مصنوعی شما هستم. هر سوالی دارید بپرسید — درباره پلنر، کارها، یا هر چیز دیگری.', 'chat.placeholder': 'هر چیزی بپرسید...', 'chat.aria': 'دستیار هوش مصنوعی', 'chat.setupTitle': 'تنظیم هوش مصنوعی', 'chat.setupBody': 'کلید API Gemini گوگل خود را وارد کنید تا دستیار هوش مصنوعی فعال شود.', 'chat.cancel': 'انصراف', 'chat.save': 'ذخیره', 'chat.thinking': 'در حال فکر کردن...',     'chat.error': 'مشکلی پیش آمد. کلید API خود را بررسی کنید و دوباره تلاش کنید.', 'chat.noKey': 'لطفاً ابتدا کلید API Gemini خود را تنظیم کنید.',
    'chat.apiKey': 'کلید API', 'chat.baseUrl': 'آدرس پایه', 'chat.baseUrlHint': '(خالی بگذارید برای Google Gemini)', 'chat.model': 'مدل', 'chat.modelHint': '(اختیاری)',
    'chat.webSearch': 'جستجوی وب', 'chat.webSearchHint': 'جستجوی وب برای اطلاعات بیشتر',
    'chat.tavilyKey': 'کلید API Tavily', 'chat.tavilyHint': '(رایگان در tavily.com — ۱۰۰۰ جستجو در ماه)', 'chat.tavilyRequired': 'جستجوی وب نیاز به کلید API Tavily دارد.',
    'chat.actionTitle': 'تأیید عملیات', 'chat.actionSubtitle': 'تغییرات را قبل از اعمال بررسی و تأیید کنید',
    'chat.actionApprove': 'تأیید همه', 'chat.actionReject': 'رد همه', 'chat.actionEdit': 'ویرایش', 'chat.actionRemove': 'حذف',
    'chat.actionCreate': 'ایجاد کار', 'chat.actionEditTask': 'ویرایش کار', 'chat.actionDelete': 'حذف کار',
    'chat.actionComplete': 'انجام کار', 'chat.actionStar': 'ستاره‌دار کردن', 'chat.actionAddList': 'افزودن لیست', 'chat.actionDeleteList': 'حذف لیست',
    'chat.action.none': 'عملیاتی برای تأیید وجود ندارد',
    'sc.palette': 'پالت دستورها',
    'sc.nl': 'ورود سریع می‌فهمد: «فردا ساعت ۱۷ !important #work» — تاریخ، ساعت، اهمیت، لیست و تکرار.',
    'pk.nextweek': 'هفتهٔ بعد',
    'tpl.work': 'محل کار', 'tpl.personal': 'شخصی', 'tpl.shopping': 'خرید',
    'tpl.study': 'مطالعه', 'tpl.fitness': 'ورزش', 'tpl.travel': 'سفر',
    'lbl.icon': 'آیکون', 'tt.options': 'گزینه‌های افزودن', 'cx.auto': 'خودکار (همین نما)',
    'sort.label': 'ترتیب', 'sort.manual': 'دستی', 'sort.due': 'طبق سررسید',
    'sort.alpha': 'الفبایی', 'sort.imp': 'طبق اهمیت', 'sort.created': 'جدیدترین',
    'cx.when': 'چه زمانی', 'cx.alert': 'یادآوری', 'cx.place': 'افزودن به', 'cx.reset': 'بازنشانی گزینه‌ها',
    'dg.schedule': 'زمان‌بندی', 'dg.organize': 'سازمان‌دهی', 'nl.start': 'از قالب شروع کنید',
  },
};
const t = (key, vars) => {
  let s = (STRINGS[S?.settings?.lang || 'en'] && STRINGS[S.settings.lang][key]) || STRINGS.en[key] || key;
  if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', String(vars[k]));
  return s;
};

/* Localized month / weekday names */
const MONTHS_G = {
  en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  fa: ['ژانویه','فوریه','مارس','آوریل','مه','ژوئن','ژوئیه','اوت','سپتامبر','اکتبر','نوامبر','دسامبر'],
};
const MONTHS_G_SHORT = {
  en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  fa: ['ژانویه','فوریه','مارس','آوریل','مه','ژوئن','ژوئیه','اوت','سپتامبر','اکتبر','نوامبر','دسامبر'],
};
const MONTHS_J = {
  en: ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'],
  fa: ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'],
};
/* Indexed by JS getUTCDay(): index 0 = Sunday */
const WD_FULL = {
  en: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  fa: ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'],
};
/* Ordered from week start (en: Sunday first, fa: Saturday first) */
const WD_MIN = {
  en: ['Su','Mo','Tu','We','Th','Fr','Sa'],
  fa: ['ش','ی','د','س','چ','پ','ج'],
};
const lang = () => S.settings.lang;
const weekStart = () => lang() === 'fa' ? 6 : 0; // 0=Sun, 6=Sat
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFaDigits = s => String(s).replace(/\d/g, d => FA_DIGITS[d]);
/** Locale-aware number formatting. */
const fmtNum = n => lang() === 'fa' ? toFaDigits(n) : String(n);
const fmtY = y => fmtNum(y);

/**
 * Format an ISO date into BOTH calendar systems.
 * @returns {{g:string, j:string}} display strings (already localized/digits)
 */
function formatDateParts(iso, opts = {}) {
  if (!iso) return null;
  const long = !!opts.long, shortM = !!opts.shortMonth;
  const L = lang();
  const g = parseISO(iso), j = jPart(iso);
  const now = new Date();
  const wdFull = WD_FULL[L][weekdayOf(iso)];
  const fa = L === 'fa';

  // Gregorian string
  let gmName = (long || !shortM) ? MONTHS_G[L][g.gm - 1] : MONTHS_G_SHORT[L][g.gm - 1];
  if (!long && shortM) gmName = MONTHS_G_SHORT[L][g.gm - 1];
  let gStr;
  const sameGY = g.gy === now.getFullYear();
  if (long) gStr = fa
    ? `${wdFull} ${fmtNum(g.gd)} ${gmName} ${fmtY(g.gy)}`
    : `${wdFull}, ${gmName} ${g.gd}, ${g.gy}`;
  else gStr = fa
    ? `${fmtNum(g.gd)} ${gmName}${sameGY ? '' : ' ' + fmtY(g.gy)}`
    : `${shortM ? MONTHS_G_SHORT[L][g.gm - 1] : gmName} ${fmtNum(g.gd)}${sameGY ? '' : ', ' + fmtY(g.gy)}`;

  // Jalali string
  const jmName = MONTHS_J[L][j.jm - 1];
  let jStr;
  if (long) jStr = `${wdFull} ${fmtNum(j.jd)} ${jmName} ${fmtY(j.jy)}`;
  else jStr = `${fmtNum(j.jd)} ${jmName} ${fmtY(j.jy)}`;

  return { g: gStr, j: jStr };
}

/** HTML for a dual-calendar inline value: primary calendar first. */
function ddHTML(iso, opts = {}) {
  const p = formatDateParts(iso, opts);
  if (!p) return '';
  const prim = S.settings.calendar === 'jalali' ? 'j' : 'g';
  const sec = prim === 'j' ? 'g' : 'j';
  return `<b class="pri">${p[prim]}</b><span class="cal-2nd">${p[sec]}</span>`;
}
/** Plain-text version (for toasts / notifications). */
function ddText(iso, opts) {
  const p = formatDateParts(iso, opts);
  return p ? (S.settings.calendar === 'jalali' ? `${p.j} (${p.g})` : `${p.g} (${p.j})`) : '';
}

/* ===================== 5. State Management ===================== */
const STORE_KEY = 'planer.state.v1';
const LIST_COLORS = ['rose','amber','grass','emerald','teal','sky','indigo','violet','pink','slate'];

/* Curated background gallery for lists and My Day */
const BG_GALLERY = [
  { id: 'sunset', name: 'Sunset', type: 'gradient', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'ocean', name: 'Ocean', type: 'gradient', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'forest', name: 'Forest', type: 'gradient', value: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
  { id: 'midnight', name: 'Midnight', type: 'gradient', value: 'linear-gradient(135deg, #0c0c1d 0%, #1a1a3e 50%, #2d1b69 100%)' },
  { id: 'peach', name: 'Peach', type: 'gradient', value: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { id: 'aurora', name: 'Aurora', type: 'gradient', value: 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 50%, #6a11cb 100%)' },
  { id: 'rose', name: 'Rose Gold', type: 'gradient', value: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' },
  { id: 'fire', name: 'Fire', type: 'gradient', value: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' },
  { id: 'lavender', name: 'Lavender', type: 'gradient', value: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
  { id: 'emerald', name: 'Emerald', type: 'gradient', value: 'linear-gradient(135deg, #0ba360 0%, #3cba92 100%)' },
  { id: 'night', name: 'Night Sky', type: 'gradient', value: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
  { id: 'candy', name: 'Candy', type: 'gradient', value: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'deep', name: 'Deep Sea', type: 'gradient', value: 'linear-gradient(135deg, #0052D4 0%, #4364F7 50%, #6FB1FC 100%)' },
  { id: 'autumn', name: 'Autumn', type: 'gradient', value: 'linear-gradient(135deg, #bf5f2f 0%, #d4a76a 100%)' },
  { id: 'mint', name: 'Mint', type: 'gradient', value: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
  { id: 'cosmic', name: 'Cosmic', type: 'gradient', value: 'linear-gradient(135deg, #0b0b1a 0%, #1a0533 30%, #2d1b69 60%, #4a1a6b 100%)' },
  { id: 'spring', name: 'Spring', type: 'gradient', value: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)' },
  { id: 'warm', name: 'Warm Glow', type: 'gradient', value: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' },
];
const MYDAY_BG_KEY = 'planer.myday.bg';

const SMART = [
  { id: 'myday',     icon: 'i-sunrise', cls: 'c-myday' },
  { id: 'important', icon: 'i-star',    cls: 'c-imp' },
  { id: 'planned',   icon: 'i-cal',     cls: 'c-plan' },
  { id: 'calendar',  icon: 'i-grid',    cls: 'c-cal' },
  { id: 'tasks',     icon: 'i-clip',    cls: '' },
];

/* Achievement definitions — test receives a context {total, streak, best, lists, flags} */
const ACHIEVEMENTS = [
  { id: 'first',    icon: 'i-spark',   name: { en: 'First Step', fa: 'اولین قدم' },       desc: { en: 'Complete your first task', fa: 'اولین کارت را انجام بده' },        test: c => c.total >= 1 },
  { id: 'ten',      icon: 'i-check',   name: { en: 'Warming Up', fa: 'گرم شدی' },         desc: { en: 'Complete 10 tasks', fa: '۱۰ کار انجام بده' },                     test: c => c.total >= 10 },
  { id: 'fifty',    icon: 'i-star',    name: { en: 'Half Century', fa: 'نیم قرن' },       desc: { en: 'Complete 50 tasks', fa: '۵۰ کار انجام بده' },                     test: c => c.total >= 50 },
  { id: 'hundred',  icon: 'i-trophy',  name: { en: 'Centurion', fa: 'صدتایی' },           desc: { en: 'Complete 100 tasks', fa: '۱۰۰ کار انجام بده' },                   test: c => c.total >= 100 },
  { id: 'streak3',  icon: 'i-flame',   name: { en: 'On Fire', fa: 'آتشین' },              desc: { en: '3-day streak', fa: 'زنجیرهٔ ۳ روزه' },                            test: c => c.best >= 3 },
  { id: 'streak7',  icon: 'i-flame',   name: { en: 'Unstoppable', fa: 'متوقف‌نشدنی' },     desc: { en: '7-day streak', fa: 'زنجیرهٔ ۷ روزه' },                            test: c => c.best >= 7 },
  { id: 'streak30', icon: 'i-flame',   name: { en: 'Iron Habit', fa: 'عادت آهنین' },      desc: { en: '30-day streak', fa: 'زنجیرهٔ ۳۰ روزه' },                          test: c => c.best >= 30 },
  { id: 'planner',  icon: 'i-clip',    name: { en: 'Architect', fa: 'معمار' },            desc: { en: 'Create 3 lists', fa: '۳ لیست بساز' },                             test: c => c.lists >= 3 },
  { id: 'earlybird',icon: 'i-sunrise', name: { en: 'Early Bird', fa: 'سحرخیز' },          desc: { en: 'Finish a task before 8 AM', fa: 'قبل از ۸ صبح کاری را تمام کن' }, test: c => c.flags.earlybird },
  { id: 'nightowl', icon: 'i-moon',    name: { en: 'Night Owl', fa: 'شب‌زنده‌دار' },        desc: { en: 'Finish a task after 10 PM', fa: 'بعد از ۱۰ شب کاری را تمام کن' }, test: c => c.flags.nightowl },
  { id: 'allclear', icon: 'i-inbox',   name: { en: 'Clean Slate', fa: 'صفحهٔ پاک' },      desc: { en: 'Clear a whole list in one go', fa: 'یک لیست را کامل خالی کن' },   test: c => c.flags.allclear },
];

/* Fixed solar-calendar Persian holidays/events, keyed by Jalali month/day */
const JAL_HOLIDAYS = [
  { m: 1, d: 1,  name: { en: 'Nowruz', fa: 'نوروز' } },
  { m: 1, d: 2,  name: { en: 'Nowruz holiday', fa: 'عید نوروز' } },
  { m: 1, d: 3,  name: { en: 'Nowruz holiday', fa: 'تعطیل نوروز' } },
  { m: 1, d: 4,  name: { en: 'Nowruz holiday', fa: 'تعطیل نوروز' } },
  { m: 1, d: 12, name: { en: 'Islamic Republic Day', fa: 'روز جمهوری اسلامی' } },
  { m: 1, d: 13, name: { en: 'Nature Day', fa: 'روز طبیعت' } },
  { m: 9, d: 30, name: { en: 'Yalda Night', fa: 'شب یلدا' } },
  { m: 11, d: 22, name: { en: 'Revolution Day', fa: 'پیروزی انقلاب اسلامی' } },
  { m: 12, d: 29, name: { en: 'Oil Nationalization Day', fa: 'ملی شدن صنعت نفت' } },
];
function jalHoliday(iso) {
  const j = jPart(iso);
  return JAL_HOLIDAYS.find(h => h.m === j.jm && h.d === j.jd) || null;
}

/* Accent color choices for the Settings picker ('' = theme default) */
const ACCENTS = ['', '#6552e6', '#0ea5e9', '#00b8d9', '#30a46c', '#f5a524', '#e9198f', '#e5484d', '#7c3aed'];

/* Icon choices for custom lists ('' = letter avatar) */
const LIST_ICONS = ['', 'i-brief', 'i-home', 'i-book', 'i-cart', 'i-heart', 'i-fit', 'i-plane', 'i-music'];

/* One-click list presets for the new-list form */
const LIST_TEMPLATES = [
  { key: 'work',     color: 'sky',     icon: 'i-brief' },
  { key: 'personal', color: 'rose',    icon: 'i-heart' },
  { key: 'shopping', color: 'amber',   icon: 'i-cart' },
  { key: 'study',    color: 'indigo',  icon: 'i-book' },
  { key: 'fitness',  color: 'emerald', icon: 'i-fit' },
  { key: 'travel',   color: 'teal',    icon: 'i-plane' },
];

/* Per-view sort options */
const SORTS = [['manual', 'sort.manual'], ['due', 'sort.due'], ['alpha', 'sort.alpha'], ['imp', 'sort.imp'], ['created', 'sort.created']];

/* Group-by options */
const GROUPS = [['none', 'group.none'], ['priority', 'group.priority'], ['list', 'group.list'], ['due', 'group.due']];

/* Repeat options shared by the drawer and the composer */
const REP_OPTS = [['none', 'rep.none'], ['daily', 'rep.daily'], ['weekly', 'rep.weekly'], ['monthly', 'rep.monthly'], ['yearly', 'rep.yearly'], ['custom', 'rep.custom']];

/* Virtualization: only engage for big lists so small ones render exactly as before */
const VIRTUAL_THRESHOLD = 150;   // rows per <ul> before windowing kicks in
const OVERSCAN_PX = 420;         // extra px rendered beyond the viewport edges
const VIEW_FALLBACK = 700;       // assumed scroller height when clientHeight is 0 (tests/embedded)

let S = null;                 // persisted state
const ui = {
  view: 'myday',              // smart keys | 'list:<id>' | 'calendar'
  search: '',
  drawerId: null,             // open task id
  compCollapsed: {},          // per-view collapsed flags
  cal: null,                  // calendar view page: {y, m0} in Gregorian
  calSel: null,               // calendar selected day (ISO gregorian)
  sel: new Set(),             // multi-select task ids (runtime only)
  rescueDismissed: false,
  pal: { items: [], idx: 0 }, // command palette session
  composer: { due: null, time: '', repeat: null, important: false, listId: null },
  _vls: {},                   // mounted virtual lists: key -> instance
  _pendVL: {},                // specs queued by the current template pass
  _flash: [],                 // ids to animate after next render
  _enter: false,              // play stagger entrance on next render
  pk: null,                   // picker session
  confirmCb: null,
  lastRemoved: null,
};

function defaultState() {
  return {
    v: 1,
    seq: 1,
    settings: {
      lang: (navigator.language || '').toLowerCase().startsWith('fa') ? 'fa' : 'en',
      theme: 'aurora',
      mode: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      autoTheme: false,
      accent: '',
      sound: false,
      calendar: 'gregorian',
      sortModes: {},
      lastView: 'myday',
    },
    stats: { completionsByDay: {}, achievements: {}, flags: {} },
    lists: [],
    groups: [],  // [{ id, name, collapsed, listIds: [] }]
    tasks: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) { console.log('[Planer] No saved state found'); return null; }
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') { console.log('[Planer] Invalid state format'); return null; }
    const def = defaultState();
    d.settings = Object.assign({}, def.settings, d.settings || {});
    if (!d.settings.sortModes || typeof d.settings.sortModes !== 'object') d.settings.sortModes = {};
    d.stats = Object.assign({ completionsByDay: {}, achievements: {}, flags: {} }, d.stats || {});
    for (const k of ['completionsByDay', 'achievements', 'flags']) {
      if (!d.stats[k] || typeof d.stats[k] !== 'object') d.stats[k] = {};
    }
    d.lists = Array.isArray(d.lists) ? d.lists.map(l => ({ ...l, icon: l.icon || '', bg: l.bg || null })) : [];
    d.groups = Array.isArray(d.groups) ? d.groups : [];
    d.tasks = Array.isArray(d.tasks) ? d.tasks.map(normalizeTask) : [];
    d.seq = Number.isFinite(d.seq) ? d.seq : 1;
    console.log('[Planer] State loaded successfully:', { lang: d.settings.lang, theme: d.settings.theme, mode: d.settings.mode });
    return d;
  } catch (e) { console.error('[Planer] Error loading state:', e); return null; }
}
function normalizeTask(x) {
  return {
    id: x.id || uid(),
    listId: x.listId || 'tasks',
    title: String(x.title ?? ''),
    notes: String(x.notes ?? ''),
    steps: Array.isArray(x.steps) ? x.steps.map(st => ({
      id: st.id || uid(), text: String(st.text ?? ''), done: !!st.done,
    })) : [],
    completed: !!x.completed,
    completedAt: x.completedAt || null,
    important: !!x.important,
    myDay: !!x.myDay,
    due: x.due || null,                                   // ISO gregorian yyyy-mm-dd
    reminder: x.reminder || null,                          // ISO gregorian yyyy-mm-ddThh:mm
    repeat: x.repeat && x.repeat.type ? { type: x.repeat.type, every: x.repeat.every || 2 } : null,
    notified: !!x.notified,
    order: Number.isFinite(x.order) ? x.order : 0,
    createdAt: x.createdAt || new Date().toISOString().slice(0, 10),
    // --- v2 fields ---
    priority: x.priority || 'none',                       // 'none'|'low'|'medium'|'high'
    tags: Array.isArray(x.tags) ? x.tags.map(t => ({
      id: t.id || uid(), name: String(t.name ?? ''), color: String(t.color ?? '#6366f1'),
    })) : [],
    attachments: Array.isArray(x.attachments) ? x.attachments.map(a => ({
      id: a.id || uid(), name: String(a.name ?? ''), type: String(a.type ?? ''),
      size: Number(a.size ?? 0), data: String(a.data ?? ''),
    })) : [],
    dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn : [],
  };
}
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }
function saveNow() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(S, (k, v) => k.startsWith('_') ? undefined : v));
  } catch (e) { console.warn('Planer: could not save data.', e); }
  if (window._planerAutoSync) debouncedCloudSync();
}
window.addEventListener('beforeunload', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

/* ===================== 6. Selectors ===================== */
const byId = id => S.tasks.find(x => x.id === id);
const getTask = byId;
const getList = id => S.lists.find(l => l.id === id);
const listName = id => getList(id)?.name || t('nav.tasks');
const viewListId = () => ui.view.startsWith('list:') ? ui.view.slice(5) : null;

/** List id behind a view key ('list:<id>' -> id, 'tasks' -> 'tasks', else null). */
function viewListKey(v = ui.view) {
  return v.startsWith('list:') ? v.slice(5) : (v === 'tasks' ? 'tasks' : null);
}

/** Shared filter: does task tk belong in viewKey? */
function matchesViewFilter(tk, viewKey) {
  switch (viewKey) {
    case 'myday': return tk.myDay || tk.due === todayISO();
    case 'important': return tk.important;
    case 'planned': return !!tk.due;
    default: return tk.listId === viewListKey(viewKey);
  }
}

function matchesView(tk) { return matchesViewFilter(tk, ui.view); }
/** All tasks of current view: active sorted, then completed (newest first). */
function tasksForView(view = ui.view) {
  const pred = tk => matchesViewFilter(tk, view);
  let arr = S.tasks.filter(pred);
  // per-view sort mode (persisted); falls back to a sensible default per view
  const sm = (S.settings.sortModes && S.settings.sortModes[view]) || defaultSort(view);
  let sorter;
  switch (sm) {
    case 'due': sorter = (a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.order - b.order; break;
    case 'alpha': sorter = (a, b) => a.title.localeCompare(b.title, lang() === 'fa' ? 'fa' : 'en'); break;
    case 'imp': sorter = (a, b) => (b.important - a.important) || a.order - b.order; break;
    case 'created': sorter = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)); break;
    default: sorter = (a, b) => a.order - b.order;   // manual drag order
  }
  arr.sort(sorter);
  const active = arr.filter(x => !x.completed);
  const done = arr.filter(x => x.completed).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  return { active, done, all: [...active, ...done] };
}
function searchTasks(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return S.tasks
    .filter(x => x.title.toLowerCase().includes(q)
      || x.notes.toLowerCase().includes(q)
      || x.steps.some(s => s.text.toLowerCase().includes(q)))
    .sort((a, b) => b.order - a.order);
}
/** Sort mode helpers: persisted per view, with a default per view type. */
function defaultSort(v) { return v === 'planned' ? 'due' : 'manual'; }
function sortModeOf(v) { return (S.settings.sortModes && S.settings.sortModes[v]) || defaultSort(v); }
function sortSelHTML() {
  const cur = sortModeOf(ui.view);
  const grpCur = S.settings.groupModes?.[ui.view] || 'none';
  return `<div class="sort-group-row">
    <select class="sortsel" data-change="sort-sel" aria-label="${esc(t('sort.label'))}">
      ${SORTS.map(([v, k]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t(k))}</option>`).join('')}
    </select>
    <select class="sortsel" data-change="group-sel" aria-label="${esc(t('lbl.group'))}">
      ${GROUPS.map(([v, k]) => `<option value="${v}"${v === grpCur ? ' selected' : ''}>${esc(t(k))}</option>`).join('')}
    </select>
  </div>`;
}

function countActive(viewKey) {  let n = 0;
  for (const x of S.tasks) {
    if (x.completed) continue;
    if (viewKey === 'myday' && (x.myDay || x.due === todayISO())) n++;
    else if (viewKey === 'important' && x.important) n++;
    else if (viewKey === 'planned' && x.due) n++;
    else if (viewKey === 'calendar' && !x.completed && x.due === todayISO()) n++;
    else if (viewKey === 'tasks' && x.listId === 'tasks') n++;
    else if (viewKey.startsWith('list:') && x.listId === viewKey.slice(5)) n++;
  }
  return n;
}

/* ===================== 7. Mutations ===================== */
function persistAndRender(flashIds) {
  if (flashIds) ui._flash = flashIds;
  saveSoon();
  renderAll();
}

function addTask({ title, listId, important = false, myDay = false, due = null }) {
  const tk = {
    id: uid(), listId, title, notes: '', steps: [],
    completed: false, completedAt: null,
    important, myDay, due, reminder: null, repeat: null,
    notified: false, order: ++S.seq,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  S.tasks.push(tk);
  return tk;
}

function spawnRepetition(src) {
  const due = src.due ? nextDue(src.due, src.repeat) : addDaysISO(todayISO(), src.repeat.type === 'daily' ? 1 : 7);
  const clone = normalizeTask({
    ...JSON.parse(JSON.stringify({ ...src, _busy: undefined })),
    id: uid(),
    completed: false, completedAt: null,
    steps: src.steps.map(s => ({ id: uid(), text: s.text, done: false })),
    due,
    myDay: due === todayISO() ? src.myDay : false,
    notified: false,
    order: ++S.seq,
    createdAt: todayISO(),
  });
  delete clone._busy;
  S.tasks.push(clone);
  return clone;
}
function nextDue(iso, rep) {
  switch (rep.type) {
    case 'daily': return addDaysISO(iso, 1);
    case 'weekly': return addDaysISO(iso, 7);
    case 'monthly': return addMonthsISO(iso, 1);
    case 'yearly': return addYearsISO(iso, 1);
    default: return addDaysISO(iso, clampN(rep.every || 2, 2, 365));
  }
}
const repeatsOn = tk => tk.repeat && tk.repeat.type && tk.repeat.type !== 'none';

function removeTask(id) {
  const idx = S.tasks.findIndex(x => x.id === id);
  if (idx < 0) return;
  ui.lastRemoved = { task: S.tasks[idx], idx };
  S.tasks.splice(idx, 1);
  toast(t('toast.deleted'), { undo: true });
}
function undoRemove() {
  if (!ui.lastRemoved) return;
  const { task, idx } = ui.lastRemoved;
  S.tasks.splice(clampN(idx, 0, S.tasks.length), 0, task);
  ui.lastRemoved = null;
  persistAndRender([task.id]);
  ensureTaskVisible(task.id);
}
function clearCompletedInView() {
  const { done } = tasksForView();
  const ids = new Set(done.map(x => x.id));
  S.tasks = S.tasks.filter(x => !ids.has(x.id));
  persistAndRender();
}

function addList(name, color, icon) {
  const li = {
    id: uid(), name,
    color: color || LIST_COLORS[Math.floor(Math.random() * LIST_COLORS.length)],
    icon: icon || '',
    bg: null,  // { type: 'none'|'gradient'|'photo', value: string }
    createdAt: Date.now(),
  };
  S.lists.push(li);
  return li;
}
function deleteList(id) {
  S.tasks.forEach(x => { if (x.listId === id) x.listId = 'tasks'; });
  S.lists = S.lists.filter(l => l.id !== id);
  // Remove from groups
  for (const g of (S.groups || [])) {
    g.listIds = (g.listIds || []).filter(lid => lid !== id);
  }
  if (ui.view === 'list:' + id) { ui.view = 'tasks'; S.settings.lastView = 'tasks'; }
  toast(t('toast.listDeleted'));
}

/* List Groups */
function addGroup(name) {
  if (!S.groups) S.groups = [];
  const g = { id: uid(), name, collapsed: false, listIds: [] };
  S.groups.push(g);
  return g;
}
function deleteGroup(id) {
  // Move lists to ungrouped
  const g = (S.groups || []).find(x => x.id === id);
  if (g) {
    // Lists stay in S.lists, just removed from group
  }
  S.groups = (S.groups || []).filter(x => x.id !== id);
}
function toggleGroup(id) {
  const g = (S.groups || []).find(x => x.id === id);
  if (g) { g.collapsed = !g.collapsed; saveSoon(); renderSidebar(); }
}
function moveListToGroup(listId, groupId) {
  // Remove from any current group
  for (const g of (S.groups || [])) {
    g.listIds = (g.listIds || []).filter(lid => lid !== listId);
  }
  // Add to new group
  const g = (S.groups || []).find(x => x.id === groupId);
  if (g) {
    if (!g.listIds) g.listIds = [];
    g.listIds.push(listId);
  }
  saveSoon(); renderSidebar();
}

/** Commit a manual reorder performed via drag & drop. */
function commitReorder(movedId, visibleIds /* final order of ACTIVE rows */) {
  const listId = viewListKey(); if (!listId) return;
  const all = S.tasks.filter(x => x.listId === listId);
  const doneIds = all.filter(x => x.completed).map(x => x.id);
  const finalIds = [...visibleIds, ...doneIds];
  finalIds.forEach((id, i) => { const x = byId(id); if (x) x.order = i + 1; });
  S.seq = Math.max(S.seq, finalIds.length + 1);
  persistAndRender();
}

/* ===================== 8. Rendering Engine ===================== */
function renderAll() {
  renderSidebar();
  renderView();
  updateDocTitle();
  checkAchievements();
  if (ui.drawerId) {
    if (!byId(ui.drawerId)) closeDrawer();
    else refreshDrawerValues();
  }
}
function updateDocTitle() {
  const n = countActive('myday');
  document.title = (n ? `(${fmtNum(n)}) ` : '') + t('app.name');
}
/** Sync the topbar search input + clear button (module-scope for reuse). */
function setSearchBox(v) {
  const si = $('#searchInput');
  if (!si) return;
  si.value = v;
  $('#btnClearSearch').hidden = !v;
}

/* ---- Sidebar ---- */
/** Avatar for a custom list: chosen icon when set, otherwise the initial letter. */
function listAvatarHTML(l, extra = 'sm') {
  if (l.icon) {
    return `<span class="nav-ic av-ic ${extra === 'sm' ? '' : 'lg'}" style="--av:var(--lc-${l.color})" aria-hidden="true"><svg><use href="#${l.icon}"/></svg></span>`;
  }
  return `<span class="avatar ${extra}" data-color="${l.color}" aria-hidden="true">${esc((l.name.trim()[0] || '?').toUpperCase())}</span>`;
}
function navItemHTML(key, label, icon, colorCls, avatar) {
  const active = ui.view === key ? ' active' : '';
  const n = countActive(key);
  const ic = avatar
    ? listAvatarHTML(avatar)
    : `<span class="nav-ic"><svg><use href="#${icon}"/></svg></span>`;
  const kebab = key.startsWith('list:')
    ? `<button class="ibtn kebab" data-action="list-menu" data-id="${key.slice(5)}" aria-label="${esc(t('a.listMenu'))}"><svg><use href="#i-kebab"/></svg></button>`
    : '';
  return `<li class="nav-item${active}" data-view="${key}">
    <button class="nav-main" data-action="select-view" data-view="${key}">${ic}<span class="nav-lbl">${esc(label)}</span><span class="count">${n ? fmtNum(n) : ''}</span></button>${kebab}</li>`;
}
function renderSidebar() {
  $('#smartNav').innerHTML = SMART.map(s =>
    navItemHTML(s.id, t('nav.' + s.id), s.icon, s.cls)).join('');
  // Group lists
  const groupedIds = new Set((S.groups || []).flatMap(g => g.listIds || []));
  const ungrouped = S.lists.filter(l => !groupedIds.has(l.id));
  let listHtml = '';
  // Render groups
  for (const g of (S.groups || [])) {
    const collapsed = g.collapsed;
    const chevronCls = collapsed ? '' : ' rotated';
    const chevron = 'i-chev';
    listHtml += `<li class="side-group-header" data-group-id="${g.id}">
      <button class="nav-main group-toggle" data-action="toggle-group" data-id="${g.id}">
        <svg class="group-chevron${chevronCls}"><use href="#${chevron}"/></svg>
        <span class="nav-lbl">${esc(g.name)}</span>
        <span class="count">${(g.listIds || []).length}</span>
      </button>
    </li>`;
    if (!collapsed) {
      for (const lid of (g.listIds || [])) {
        const l = S.lists.find(x => x.id === lid);
        if (l) listHtml += navItemHTML('list:' + l.id, l.name, '', '', l);
      }
    }
  }
  // Render ungrouped lists
  if (ungrouped.length) {
    if (S.groups && S.groups.length) {
      listHtml += `<li class="side-group-label">${esc(t('group.ungrouped'))}</li>`;
    }
    listHtml += ungrouped.map(l => navItemHTML('list:' + l.id, l.name, '', '', l)).join('');
  }
  if (!S.lists.length) listHtml = `<li class="side-empty">${esc(t('side.empty'))}</li>`;
  $('#userListUl').innerHTML = listHtml;
  buildCxList();
  syncSettingsUI();
}

/* ---- View templates ---- */
function chipHTML(icon, innerHTML, cls = '') {
  return `<span class="chip ${cls}"><svg><use href="#${icon}"/></svg><span>${innerHTML}</span></span>`;
}
function dueChipHTML(tk) {
  if (!tk.due) return '';
  const today = todayISO(), tmr = addDaysISO(today, 1);
  let cls = 'clickable', label = ddHTML(tk.due, { shortMonth: true });
  if (tk.due < today && !tk.completed) cls += ' overdue';
  else if (tk.due === today) cls += ' today-chip';
  else if (tk.due === tmr) { cls += ''; }
  return `<button type="button" class="chip ${cls}" data-action="chip-due" data-id="${tk.id}"><svg><use href="#i-cal"/></svg><span>${label}</span></button>`;
}
function metaChipsHTML(tk, ctx) {
  let h = '';
  if (tk.priority && tk.priority !== 'none') h += `<span class="chip pri-${tk.priority}" title="${t('lbl.priority')}">${t('pri.' + tk.priority)}</span>`;
  h += dueChipHTML(tk);
  h += daysLeftChipHTML(tk);
  if (tk.reminder) h += chipHTML('i-bell', fmtReminderShort(tk.reminder));
  if (repeatsOn(tk)) h += chipHTML('i-repeat', esc(repeatLabel(tk.repeat)));
  if (tk.notes.trim()) h += chipHTML('i-note', '');
  if (tk.steps.length) h += chipHTML('i-check', `${fmtNum(tk.steps.filter(s => s.done).length)}/${fmtNum(tk.steps.length)}`);
  if (tk.attachments && tk.attachments.length) h += chipHTML('i-clip', `${fmtNum(tk.attachments.length)}`);
  if (tk.dependsOn && tk.dependsOn.length) {
    const blocked = tk.dependsOn.some(did => { const dt = getTask(did); return dt && !dt.completed; });
    if (blocked && !tk.completed) h += `<span class="chip chip-blocked" title="${t('lbl.blocked')}">🔒</span>`;
  }
  for (const tag of (tk.tags || []).slice(0, 3)) {
    h += `<span class="chip tag-chip" style="background:${esc(tag.color)}22;color:${esc(tag.color)};border:1px solid ${esc(tag.color)}44">${esc(tag.name)}</span>`;
  }
  if (ctx.showList) {
    const l = getList(tk.listId);
    if (l) h += `<span class="chip list-chip" style="--av:var(--lc-${l.color})"><span class="dot"></span><span>${esc(l.name)}</span></span>`;
  }
  return h;
}
function fmtReminderShort(rem) {
  const [d, tm] = rem.split('T');
  const p = formatDateParts(d, { shortMonth: true });
  const time = lang() === 'fa' ? toFaDigits(tm) : tm;
  return `<b class="pri">${p[lang() === 'fa' ? 'j' : 'g']}</b><span class="cal-2nd">${time}</span>`;
}
function repeatLabel(rep) {
  if (rep.type === 'custom') return t('every.days', { n: fmtNum(rep.every || 2) });
  return t('rep.' + rep.type);
}
/** "3 days left" / «فردا» / "{n} days late" badge shown beside the due date. */
function daysLeftChipHTML(tk) {
  if (!tk.due || tk.completed) return '';
  const d = diffDays(todayISO(), tk.due);
  let txt, cls = 'dl';
  if (d === 0) txt = t('chip.today');
  else if (d === 1) txt = t('chip.tomorrow');
  else if (d > 1) txt = t('days.left', { n: fmtNum(d) });
  else { txt = t('days.late', { n: fmtNum(-d) }); cls += ' late'; }
  return `<span class="chip ${cls}">${txt}</span>`;
}

function taskRowHTML(tk, ctx) {
  const doneCls = tk.completed ? ' done' : '';
  const impCls = tk.important ? ' starred' : '';
  const priCls = tk.priority && tk.priority !== 'none' ? ` pri-row-${tk.priority}` : '';
  const titleHtml = ctx.query ? highlight(tk.title, ctx.query) : esc(tk.title);
  const handle = ctx.manual && !tk.completed
    ? `<button class="ibtn drag-handle" data-action="drag" aria-label="${esc(t('a.drag'))}" title="${esc(t('a.drag'))}"><svg><use href="#i-grip"/></svg></button>` : '';
  return `<li class="task${doneCls}${impCls}${priCls}${ui.sel.has(tk.id) ? ' selected' : ''}" data-id="${tk.id}" style="--i:${ctx.i}" data-action="open-task">
    <button class="check" data-action="toggle-complete" data-id="${tk.id}" aria-label="${esc(t('a.complete'))}"><svg viewBox="0 0 24 24"><use href="#i-check"/></svg></button>
    <div class="t-main">
      <span class="t-title">${titleHtml}</span>
      ${(tk.due || tk.reminder || tk.notes.trim() || tk.steps.length || repeatsOn(tk) || ctx.showList) ? `<div class="t-meta">${metaChipsHTML(tk, ctx)}</div>` : ''}
    </div>
    <div class="t-actions">
      <button class="ibtn pri-btn${(tk.priority || 'none') !== 'none' ? ' pri-on pri-color-' + tk.priority : ''}" data-action="cycle-pri" data-id="${tk.id}" title="${t('lbl.priority')}" aria-label="${t('lbl.priority')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h6"/></svg></button>
      <button class="ibtn star-btn${tk.important ? ' on' : ''}" data-action="star-row" data-id="${tk.id}" aria-label="${esc(t('a.star'))}"><svg><use href="#i-star"/></svg></button>
      <button class="ibtn del-btn" data-action="del-row" data-id="${tk.id}" aria-label="${esc(t('a.delete'))}"><svg><use href="#i-trash"/></svg></button>
      ${handle}
    </div>
  </li>`;
}

function highlight(text, q) {
  const low = text.toLowerCase(), ql = q.toLowerCase();
  const i = low.indexOf(ql);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function ringHTML(stats) {
  if (!stats.total) return '<div class="ring none"></div>';
  const pct = stats.total ? Math.round(stats.done / stats.total * 100) : 0;
  return `<div class="ring" role="img" aria-label="${esc(t('ring.tip', { p: pct }))}" title="${esc(t('ring.tip', { p: pct }))}">
    <svg viewBox="0 0 64 64"><circle class="rbg" cx="32" cy="32" r="27"/><circle class="rvg" cx="32" cy="32" r="27"/></svg>
    <div class="rtxt"><b>${fmtNum(stats.done)}</b><span>/${fmtNum(stats.total)}</span></div></div>`;
}
function animateRing() {
  const el = $('.rvg');
  if (!el) return;
  const C = 2 * Math.PI * 27;
  el.style.strokeDasharray = C;
  el.style.strokeDashoffset = C;
  const p = ui._stats.total ? ui._stats.done / ui._stats.total : 0;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = C * (1 - p); }));
}

function headerHTML(title, iconCls, hdIcon, subHTML, stats, opts = {}) {
  const bgStyle = opts.bg ? `background:${opts.bg};` : '';
  const bgCls = opts.bg ? ' hd-with-bg' : '';
  const actionsHtml = `<div class="hd-actions">
    <button type="button" class="hd-act-btn" data-action="myday-bg" title="${esc(t('bg.title'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
    <button type="button" class="hd-act-btn" data-action="open-suggestions" title="${esc(t('suggest.title'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 01-1 1h-2a1 1 0 01-1-1v-2.26C10.19 13.47 9 11.38 9 9a7 7 0 017-7z"/></svg></button>
    ${opts.streak || ''}
  </div>`;
  return `<header class="hd v-anim ${iconCls}${bgCls}" style="${bgStyle}">
    ${opts.bg ? '<div class="hd-bg-overlay"></div>' : ''}
    <span class="hd-ic"><svg><use href="#${hdIcon}"/></svg></span>
    <div class="hd-txt"><h1>${esc(title)}</h1><div class="hd-sub">${subHTML}</div></div>
    ${actionsHtml}
    ${ringHTML(stats)}
  </header>`;
}
function todaySubHTML() {
  const h = new Date().getHours();
  const greet = t(h < 12 ? 'greet.morning' : h < 18 ? 'greet.afternoon' : 'greet.evening');
  const iso = todayISO();
  const p = formatDateParts(iso, { long: true });
  const prim = S.settings.calendar === 'jalali' ? 'j' : 'g';
  const sec = prim === 'j' ? 'g' : 'j';
  return `<span class="greet">${esc(greet)}</span>
    <span class="dd-line">${p[prim]} <span class="sec-cal">— ${p[sec]}</span></span>`;
}
function countsSubHTML(activeN, doneN) {
  const iso = todayISO();
  const p = formatDateParts(iso);
  const prim = S.settings.calendar === 'jalali' ? 'j' : 'g';
  const sec = prim === 'j' ? 'g' : 'j';
  return `<span>${t('cnt.tasks', { n: fmtNum(activeN), s: activeN === 1 && lang() === 'en' ? '' : 's' })}</span>
    ${doneN ? ` · ${esc(t('stats.done', { a: fmtNum(doneN), b: fmtNum(activeN + doneN) }))}` : ''}
    <span class="sec-cal"> · ${p[prim]} (${p[sec]})</span>`;
}

function emptyHTML(icon, titleKey, subKey) {
  return `<div class="empty v-anim${titleKey === 'empty.myday' ? '' : ''}">
    <svg><use href="#${icon}"/></svg>
    <div class="e-title">${esc(t(titleKey))}</div>
    ${subKey ? `<div class="e-sub">${esc(t(subKey))}</div>` : ''}
  </div>`;
}

/** Dismissible "n overdue tasks → move to today" bar (My Day only). */
function rescueBarHTML() {
  if (ui.rescueDismissed || ui.view !== 'myday') return '';
  const T = todayISO();
  const ov = S.tasks.filter(x => !x.completed && x.due && x.due < T);
  if (!ov.length) return '';
  return `<div class="rescue-bar v-anim">
    <svg><use href="#i-bell"/></svg>
    <span>${esc(t('rescue.title', { n: fmtNum(ov.length), s: ov.length === 1 && lang() === 'en' ? '' : 's' }))}</span>
    <button type="button" class="link" data-action="rescue-move">${esc(t('rescue.move'))}</button>
    <button type="button" class="ibtn" data-action="rescue-dismiss" aria-label="${esc(t('tt.close'))}" style="opacity:.7"><svg><use href="#i-x"/></svg></button>
  </div>`;
}
function completedSectionHTML(done, manual, vdone) {
  if (!done.length) return '';
  const collapsed = !!ui.compCollapsed[ui.view];
  if (vdone) ui._pendVL.done = { tasks: done, ctx: { manual: false, showList: SMART.some(s => s.id === ui.view), query: ui.search.trim() } };
  const rows = vdone ? '' : done.map((tk, i) => taskRowHTML(tk, { i, manual: false, showList: SMART.some(s => s.id === ui.view), query: ui.search.trim() })).join('');
  return `<section class="comp v-anim${collapsed ? ' closed' : ''}">
    <button class="comp-head" data-action="comp-toggle" aria-expanded="${!collapsed}">
      <svg><use href="#i-chev"/></svg><span>${esc(t('comp.title'))}</span>
      <span class="comp-badge">${fmtNum(done.length)}</span>
    </button>
    <div class="comp-wrap"><div class="comp-inner">
      ${vdone ? '<ul class="tasks" data-vl="done"></ul>' : `<ul class="tasks">${rows}</ul>`}
      <div class="comp-foot"><button class="link danger" data-action="comp-clear">${esc(t('comp.clear'))}</button></div>
    </div></div>
  </section>`;
}

/* ---- Calendar month view ---- */

/** Build the 42-cell grid model + tasks grouped by due date for the shown page. */
function calModel() {
  const { y, m } = ui.cal;
  const firstIso = isoFromG(y, m + 1, 1);
  const ws = weekStart();
  const off = (weekdayOf(firstIso) - ws + 7) % 7;
  const start = addDaysISO(firstIso, -off);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const iso = addDaysISO(start, i);
    const g = parseISO(iso);
    cells.push({ iso, gd: g.gd, out: g.gm - 1 !== m });
  }
  const byDay = {};
  for (const tk of S.tasks) {
    if (!tk.due) continue;
    (byDay[tk.due] ||= []).push(tk);
  }
  return { cells, byDay };
}

/** 7-day strip centred on the week of the selected day; dots preview tasks. */
function tplAgenda(byDay) {
  const ws = weekStart(), L = lang();
  const sel = ui.calSel;
  const off = (weekdayOf(sel) - ws + 7) % 7;
  const start = addDaysISO(sel, -off);
  let h = '<div class="ag-strip v-anim">';
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(start, i);
    const g = parseISO(iso);
    const evs = byDay[iso] || [];
    h += `<button type="button" class="ag-cell${iso === sel ? ' sel' : ''}${iso === todayISO() ? ' today' : ''}" data-action="cal-pick" data-iso="${iso}">
      <span class="ag-wd">${WD_MIN[L][(ws + i) % 7]}</span>
      <span class="ag-d">${fmtNum(g.gd)}</span>
      <span class="ag-dots">${evs.slice(0, 3).map(e => `<i class="${e.completed ? 'dn' : ''}${e.important ? ' imp' : ''}"></i>`).join('')}</span>
    </button>`;
  }
  return h + '</div>';
}

function tplCalendar() {
  const L = lang(), ws = weekStart();
  if (!ui.cal) { const t0 = parseISO(todayISO()); ui.cal = { y: t0.gy, m: t0.gm - 1 }; }
  if (!ui.calSel) ui.calSel = todayISO();
  const { cells, byDay } = calModel();

  // Dual-calendar month title (jalali label spans two gregorian months at its edges)
  const firstIso = isoFromG(ui.cal.y, ui.cal.m + 1, 1);
  const jj = jPart(firstIso);
  const lastJj = jPart(addDaysISO(firstIso, gMonthLen(ui.cal.y, ui.cal.m + 1) - 1));
  const jLabel = jj.jm === lastJj.jm
    ? `${MONTHS_J[L][jj.jm - 1]} ${fmtY(jj.jy)}`
    : `${MONTHS_J[L][jj.jm - 1]} – ${MONTHS_J[L][lastJj.jm - 1]} ${fmtY(lastJj.jy)}`;
  const gLabel = `${MONTHS_G[L][ui.cal.m]}${ui.cal.y !== new Date().getFullYear() ? ' ' + fmtY(ui.cal.y) : ''}`;
  const monthTitle = S.settings.calendar === 'jalali'
    ? `${jLabel}<i>·</i><span class="pk-sub">${gLabel}</span>`
    : `${gLabel}<i>·</i><span class="pk-sub">${jLabel}</span>`;

  // Header stats: tasks this month + ring for the selected day
  let monthCount = 0;
  for (const iso in byDay) {
    const g = parseISO(iso);
    if (g.gy === ui.cal.y && g.gm - 1 === ui.cal.m) monthCount += byDay[iso].length;
  }
  const dayTasks = (byDay[ui.calSel] || []).slice().sort((a, b) => (a.completed - b.completed) || (a.order - b.order));
  const selDone = dayTasks.filter(x => x.completed).length;
  ui._stats = { done: selDone, total: dayTasks.length };

  const head = headerHTML(t('nav.calendar'), 'c-cal', 'i-grid',
    `<span>${esc(t('cal.inMonth', { n: fmtNum(monthCount), s: monthCount === 1 && lang() === 'en' ? '' : 's' }))}</span>`, ui._stats);

  const toolbar = `<div class="cal-bar v-anim">
    <button class="icon-btn" data-action="cal-nav" data-dir="-1" aria-label="${esc(t('a.prevMonth'))}"><svg class="flip-x"><use href="#i-chev"/></svg></button>
    <div class="cal-title">${monthTitle}</div>
    <button class="icon-btn" data-action="cal-nav" data-dir="1" aria-label="${esc(t('a.nextMonth'))}"><svg><use href="#i-chev"/></svg></button>
    <span class="flex-sp"></span>
    <button class="link" data-action="cal-nav" data-dir="0">${esc(t('pk.today'))}</button>
  </div>
  <div class="cal-week v-anim">${Array.from({ length: 7 }, (_, i) => `<span>${WD_MIN[L][(ws + i) % 7]}</span>`).join('')}</div>
  <div class="cal-grid v-anim">${cells.map(c => calCellHTML(c, byDay)).join('')}</div>`;

  const p = formatDateParts(ui.calSel, { long: true });
  const hol = jalHoliday(ui.calSel);
  const dayLabel = S.settings.calendar === 'jalali' ? `${p.j} — ${p.g}` : `${p.g} — ${p.j}`;
  const panel = `<section id="calPanel" class="v-anim">
    <div class="sr-group-label"><svg style="width:15px;height:15px"><use href="#i-cal"/></svg><span>${esc(dayLabel)}${hol ? ` · <b style="color:var(--danger)">${esc(hol.name[lang()])}</b>` : ''}</span></div>
    ${dayTasks.length
      ? `<ul class="tasks">${dayTasks.map((tk, i) => taskRowHTML(tk, { i, manual: false, showList: true })).join('')}</ul>`
      : emptyHTML('i-cal', 'cal.noDay')}
  </section>`;

  return head + tplAgenda(byDay) + toolbar + panel;
}

function calCellHTML(c, byDay) {
  const evs = byDay[c.iso] || [];
  const open = evs.filter(x => !x.completed);
  const shown = open.slice(0, 2);
  const hol = jalHoliday(c.iso);
  const cls = `cal-cell${c.out ? ' out' : ''}${c.iso === todayISO() ? ' today' : ''}${c.iso === ui.calSel ? ' sel' : ''}${hol ? ' hol' : ''}`;
  const tip = esc(ddText(c.iso) + (hol ? ' — ' + hol.name[lang()] : ''));
  let evHtml = '';
  if (evs.length) {
    // chips carry their task id: click opens the drawer, drag reschedules the day
    const bits = shown.map(x =>
      `<span class="cal-ev${x.important ? ' imp' : ''}" data-action="cal-ev" data-task="${x.id}">${esc(x.title)}</span>`).join('');
    const allDoneBit = !open.length ? '<span class="cal-ev alldone"><svg><use href="#i-check"/></svg></span>' : '';
    const more = evs.length > shown.length ? `<span class="cal-more">${t('cal.more', { n: fmtNum(evs.length - shown.length) })}</span>` : '';
    evHtml = `<span class="cal-evs">${allDoneBit}${bits}${more}</span>`;
  }
  const jd = jPart(c.iso).jd;
  const isJalaliPrimary = S.settings.calendar === 'jalali';
  const primaryDay = isJalaliPrimary ? jd : c.gd;
  const secondaryDay = isJalaliPrimary ? c.gd : jd;
  return `<div class="${cls}" data-action="cal-pick" data-iso="${c.iso}" role="button" tabindex="0" aria-label="${tip}" title="${tip}">
    <span class="cc-row"><span class="cc-primary">${fmtNum(primaryDay)}</span>${hol ? '<i class="hol-dot"></i>' : ''}</span><span class="cc-secondary">${fmtNum(secondaryDay)}</span>${evHtml}
  </div>`;
}

function tplListView() {
  const { active, done } = tasksForView();
  ui._stats = { done: done.length, total: active.length + done.length };
  const manual = !['myday', 'important', 'planned'].includes(ui.view);
  let head, empty;

  if (ui.view === 'myday') {
    const st = currentStreak();
    const streakHtml = st ? `<button type="button" class="streak-chip" data-action="open-momentum" title="${esc(t('momentum.title'))}"><svg><use href="#i-flame"/></svg>${esc(t('streak.days', { n: fmtNum(st) }))}</button>` : '';
    const sub = todaySubHTML();
    const mydayBg = localStorage.getItem(MYDAY_BG_KEY) || '';
    head = headerHTML(t('nav.myday'), 'c-myday', 'i-sunrise', sub, ui._stats, { sortable: true, bg: mydayBg, streak: streakHtml });
    empty = emptyHTML('i-sunrise', 'empty.myday', 'empty.sub.myday');
  } else {
    const lid = viewListId();
    const title = lid ? listName(lid) : t('nav.' + ui.view);
    const l = lid ? getList(lid) : null;
    const iconCls = l ? '' : ({ important: 'c-imp', planned: 'c-plan' }[ui.view] || '');
    const hdIcon = l ? 'i-clip' : ({ important: 'i-star', planned: 'i-cal' }[ui.view] || 'i-clip');
    const avatarStyle = l ? ` style="--hd-bg:var(--lc-${l.color})"` : '';
    const listBg = l?.bg?.value || '';
    head = headerHTML(title, iconCls + (l ? ' c-list' : ''), hdIcon, countsSubHTML(active.length, done.length), ui._stats, { sortable: true, bg: listBg }).replace('<span class="hd-ic"', `<span class="hd-ic"${avatarStyle}`);
    empty = emptyHTML(hdIcon, ui.view === 'important' ? 'empty.important' : ui.view === 'planned' ? 'empty.planned' : 'empty.list', 'empty.sub.list');
  }

  if (!active.length && !done.length) return head + rescueBarHTML() + empty;

  // Check if grouping is active
  const grpMode = S.settings.groupModes?.[ui.view] || 'none';
  if (grpMode !== 'none' && active.length) {
    return head + rescueBarHTML() + renderGroupedTasks(active, grpMode, manual)
      + completedSectionHTML(done, manual, done.length > VIRTUAL_THRESHOLD);
  }

  // window the active <ul> only when it is large enough to matter
  const virtA = active.length > VIRTUAL_THRESHOLD;
  const vdone = done.length > VIRTUAL_THRESHOLD;
  if (virtA) ui._pendVL.active = { tasks: active, ctx: { manual, showList: !manual, query: '' } };
  const rows = virtA ? '' : active.map((tk, i) => taskRowHTML(tk, { i, manual, showList: !manual })).join('');
  return head + rescueBarHTML()
    + (virtA ? '<ul class="tasks" data-vl="active"></ul>' : `<ul class="tasks v-anim">${rows}</ul>`)
    + completedSectionHTML(done, manual, vdone);
}

function renderGroupedTasks(tasks, mode, manual) {
  const groups = new Map();
  if (mode === 'priority') {
    const PRI_ORDER = ['high', 'medium', 'low', 'none'];
    const PRI_KEYS = { high: 'grp.high', medium: 'grp.medium', low: 'grp.low', none: 'grp.none' };
    for (const pri of PRI_ORDER) groups.set(pri, []);
    for (const tk of tasks) {
      const p = tk.priority || 'none';
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(tk);
    }
    let html = '';
    for (const pri of PRI_ORDER) {
      const items = groups.get(pri);
      if (!items.length) continue;
      html += `<div class="grp-header grp-pri-${pri}"><span class="grp-label">${t(PRI_KEYS[pri])}</span><span class="grp-count">${fmtNum(items.length)}</span></div>`;
      html += `<ul class="tasks v-anim">${items.map((tk, i) => taskRowHTML(tk, { i, manual, showList: !manual })).join('')}</ul>`;
    }
    return html;
  }
  if (mode === 'list') {
    for (const tk of tasks) {
      const lid = tk.listId || 'tasks';
      if (!groups.has(lid)) groups.set(lid, []);
      groups.get(lid).push(tk);
    }
    let html = '';
    for (const [lid, items] of groups) {
      const l = getList(lid);
      const nm = l ? l.name : t('nav.tasks');
      html += `<div class="grp-header"><span class="grp-label">${esc(nm)}</span><span class="grp-count">${fmtNum(items.length)}</span></div>`;
      html += `<ul class="tasks v-anim">${items.map((tk, i) => taskRowHTML(tk, { i, manual, showList: false })).join('')}</ul>`;
    }
    return html;
  }
  if (mode === 'due') {
    const overdue = [], today = [], week = [], later = [], noDate = [];
    const now = todayISO(), wkEnd = addDaysISO(now, 7);
    for (const tk of tasks) {
      if (!tk.due) noDate.push(tk);
      else if (tk.due < now) overdue.push(tk);
      else if (tk.due === now) today.push(tk);
      else if (tk.due <= wkEnd) week.push(tk);
      else later.push(tk);
    }
    const SECTIONS = [
      { key: 'overdue', items: overdue, cls: 'grp-overdue' },
      { key: 'chip.today', items: today, cls: 'grp-today' },
      { key: 'group.week', items: week, cls: '' },
      { key: 'group.later', items: later, cls: '' },
      { key: 'group.noDate', items: noDate, cls: '' },
    ];
    let html = '';
    for (const sec of SECTIONS) {
      if (!sec.items.length) continue;
      html += `<div class="grp-header ${sec.cls}"><span class="grp-label">${t(sec.key)}</span><span class="grp-count">${fmtNum(sec.items.length)}</span></div>`;
      html += `<ul class="tasks v-anim">${sec.items.map((tk, i) => taskRowHTML(tk, { i, manual, showList: !manual })).join('')}</ul>`;
    }
    return html;
  }
  return '';
}

function tplSearch() {
  const q = ui.search.trim();
  const results = searchTasks(q);
  ui._stats = { done: 0, total: 0 };
  const groups = new Map();
  results.forEach(r => { if (!groups.has(r.listId)) groups.set(r.listId, []); groups.get(r.listId).push(r); });
  let body = '';
  let gi = 0;
  groups.forEach((items, listId) => {
    const l = getList(listId);
    const nm = l ? l.name : t('nav.tasks');
    const av = l ? listAvatarHTML(l) : `<span class="nav-ic"><svg><use href="#i-clip"/></svg></span>`;
    const virtG = items.length > VIRTUAL_THRESHOLD;
    if (virtG) ui._pendVL['g' + gi] = { tasks: items, ctx: { manual: false, showList: false, query: q } };
    body += `<div class="sr-group-label v-anim" style="--i:${gi++}">${av}<span>${esc(nm)}</span><span class="count">${fmtNum(items.length)}</span></div>`
      + (virtG
        ? `<ul class="tasks" data-vl="g${gi - 1}"></ul>`
        : `<ul class="tasks v-anim">${items.map((tk, i) => taskRowHTML(tk, { i, manual: false, showList: false, query: q })).join('')}</ul>`);
  });
  const head = headerHTML(t('ph.search'), 'c-plan', 'i-search',
    t('results.for', { n: fmtNum(results.length), q: esc(q), s: results.length === 1 && lang() === 'en' ? '' : 's' }), ui._stats);
  return head + (results.length ? body : emptyHTML('i-search', 'empty.search', 'empty.sub.search'));
}

function renderView() {
  const scroller = $('#scroller');
  const st = scroller.scrollTop;
  const viewEl = $('#view');
  ui._vls = {}; ui._pendVL = {};
  viewEl.innerHTML = ui.search.trim() ? tplSearch() : (ui.view === 'calendar' ? tplCalendar() : tplListView());
  mountVirtualLists(viewEl);              // fill windowed <ul>s queued by templates
  if (ui._enter) {
    viewEl.classList.remove('enter'); void viewEl.offsetWidth; viewEl.classList.add('enter');
    ui._enter = false;
  }
  scroller.scrollTop = Math.max(0, Math.min(st, scroller.scrollHeight));
  if (ui._flash.length) {
    ui._flash.forEach(id => {
      const el = viewEl.querySelector(`.task[data-id="${id}"]`);
      if (el) {
        el.classList.add('anim-added');
        el.addEventListener('animationend', () => el.classList.remove('anim-added'), { once: true });
      }
    });
    ui._flash = [];
  }
  animateRing();
}

/* ===================== 9. Task detail drawer ===================== */
function openDrawer(id) {
  ui.drawerId = id;
  fillDrawer(true);
  $('#drawerRoot').classList.add('open');
  $('#drawerRoot').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  ui.drawerId = null;
  $('#drawerRoot').classList.remove('open');
  $('#drawerRoot').setAttribute('aria-hidden', 'true');
}
function fillDrawer(full) {
  const tk = byId(ui.drawerId); if (!tk) return;
  if (full) {
    $('#dTitle').value = tk.title;
    $('#dNotes').value = tk.notes;
    renderSteps();
    buildRepSel();
    buildMoveSel();
    setTimeout(() => autoResizeTextarea($('#dTitle')), 10);
  }
  refreshDrawerValues();
}
function refreshDrawerValues() {
  const tk = byId(ui.drawerId); if (!tk) return;
  $('#dStar').classList.toggle('on', tk.important);
  $('#dMyday').classList.toggle('on', tk.myDay);
  $('#dueVal').innerHTML = tk.due ? ddHTML(tk.due) : t('ph.pickDate');
  $('#dueVal').classList.toggle('has', !!tk.due);
  $('#remVal').innerHTML = tk.reminder ? fmtReminderShort(tk.reminder) : t('ph.addReminder');
  $('#remVal').classList.toggle('has', !!tk.reminder);
  $('#repSel').value = tk.repeat?.type || 'none';
  $('#repCustomWrap').hidden = tk.repeat?.type !== 'custom';
  if (tk.repeat?.type === 'custom') $('#repEvery').value = tk.repeat.every || 2;
  $('#moveSel').value = tk.listId;
  const cp = formatDateParts(tk.createdAt);
  $('#dCreated').textContent = t('created.on', { date: ddText(tk.createdAt) });
  renderPriority();
  renderTags();
  renderAttachments();
  renderDependencies();
}
function renderPriority() {
  const tk = byId(ui.drawerId); if (!tk) return;
  const pri = tk.priority || 'none';
  $('#dPriorityVal').textContent = t('pri.' + pri);
  $('#dPriorityVal').className = 'f-val' + (pri !== 'none' ? ' pri-' + pri : '');
}
function setPriority(pri) {
  const tk = byId(ui.drawerId); if (!tk) return;
  tk.priority = pri;
  refreshDrawerValues();
  persistAndRender();
}
function renderTags() {
  const tk = byId(ui.drawerId); if (!tk) return;
  const wrap = $('#dTagsWrap'); if (!wrap) return;
  wrap.innerHTML = (tk.tags || []).map(tag =>
    `<span class="d-tag" style="background:${esc(tag.color)}22;color:${esc(tag.color)};border:1px solid ${esc(tag.color)}44">${esc(tag.name)}<button class="d-tag-x" data-tagid="${tag.id}" aria-label="${t('tag.delete')}">&times;</button></span>`
  ).join('');
}
function addTagToTask(name, color) {
  const tk = byId(ui.drawerId); if (!tk) return;
  if (!tk.tags) tk.tags = [];
  tk.tags.push({ id: uid(), name, color });
  renderTags();
  persistAndRender();
}
function removeTagFromTask(tagId) {
  const tk = byId(ui.drawerId); if (!tk) return;
  tk.tags = (tk.tags || []).filter(t => t.id !== tagId);
  renderTags();
  persistAndRender();
}
function renderAttachments() {
  const tk = byId(ui.drawerId); if (!tk) return;
  const list = $('#dAttachList'); const cnt = $('#dAttachCount'); if (!list) return;
  const atts = tk.attachments || [];
  cnt.textContent = atts.length ? `(${atts.length})` : '';
  list.innerHTML = atts.map(a => {
    const isImg = a.type.startsWith('image/');
    return `<div class="d-attach-item">
      ${isImg ? `<img src="${a.data}" class="d-attach-preview" alt="${esc(a.name)}">` : `<svg class="d-attach-icon"><use href="#i-clip"/></svg>`}
      <span class="d-attach-name">${esc(a.name)}</span>
      <span class="d-attach-size">${fmtFileSize(a.size)}</span>
      <button class="ibtn tiny d-attach-del" data-attachid="${a.id}" aria-label="${t('attach.removed')}"><svg><use href="#i-trash"/></svg></button>
    </div>`;
  }).join('');
}
function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function addAttachment(file) {
  const tk = byId(ui.drawerId); if (!tk) return;
  if (file.size > 2 * 1024 * 1024) { toast(t('attach.tooLarge')); return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (!tk.attachments) tk.attachments = [];
    tk.attachments.push({ id: uid(), name: file.name, type: file.type, size: file.size, data: reader.result });
    renderAttachments();
    persistAndRender();
    toast(t('attach.added'));
  };
  reader.readAsDataURL(file);
}
function removeAttachment(attId) {
  const tk = byId(ui.drawerId); if (!tk) return;
  tk.attachments = (tk.attachments || []).filter(a => a.id !== attId);
  renderAttachments();
  persistAndRender();
  toast(t('attach.removed'));
}
function renderDependencies() {
  const tk = byId(ui.drawerId); if (!tk) return;
  const list = $('#dDepsList'); const sel = $('#dDepSelect'); if (!list) return;
  const deps = tk.dependsOn || [];
  list.innerHTML = deps.map(did => {
    const dt = getTask(did);
    if (!dt) return '';
    const status = dt.completed ? '✓' : '🔒';
    const cls = dt.completed ? 'dep-done' : 'dep-pending';
    return `<div class="d-dep-item ${cls}">
      <span class="dep-status">${status}</span>
      <span class="dep-title">${esc(dt.title)}</span>
      <button class="ibtn tiny" data-depid="${did}" aria-label="${t('dep.removed')}"><svg><use href="#i-x"/></svg></button>
    </div>`;
  }).join('');
  if (sel) {
    const tasks = S.tasks.filter(t => t.id !== tk.id && !t.completed && !(deps || []).includes(t.id));
    sel.innerHTML = `<option value="">${t('ph.selectTask')}</option>` +
      tasks.map(tt => `<option value="${tt.id}">${esc(tt.title)}</option>`).join('');
  }
}
function addDependency(targetId) {
  const tk = byId(ui.drawerId); if (!tk || !targetId) return;
  if (!tk.dependsOn) tk.dependsOn = [];
  if (!tk.dependsOn.includes(targetId)) {
    tk.dependsOn.push(targetId);
    renderDependencies();
    persistAndRender();
    toast(t('dep.added'));
  }
}
function removeDependency(depId) {
  const tk = byId(ui.drawerId); if (!tk) return;
  tk.dependsOn = (tk.dependsOn || []).filter(d => d !== depId);
  renderDependencies();
  persistAndRender();
  toast(t('dep.removed'));
}
function isBlocked(tk) {
  if (!tk.dependsOn || !tk.dependsOn.length) return false;
  return tk.dependsOn.some(did => { const dt = getTask(did); return dt && !dt.completed; });
}
function buildRepSel() {
  const sel = $('#repSel');
  sel.innerHTML = REP_OPTS.map(([v, k]) => `<option value="${v}">${esc(t(k))}</option>`).join('');
  sel.value = byId(ui.drawerId)?.repeat?.type || 'none';
  sel.dir = lang() === 'fa' ? 'rtl' : 'ltr';
}
/* ---- Smart composer option panel ---- */
function buildCxSelects() {
  const rep = $('#cxRepeat'); if (!rep) return;
  rep.innerHTML = REP_OPTS.map(([v, k]) => `<option value="${v}">${esc(t(k))}</option>`).join('');
  rep.value = ui.composer.repeat?.type || 'none';
  rep.dir = lang() === 'fa' ? 'rtl' : 'ltr';
  $('#cxEveryWrap').hidden = ui.composer.repeat?.type !== 'custom';
  buildCxList();
}
function buildCxList() {
  const ls = $('#cxList'); if (!ls) return;
  const cur = ui.composer.listId || '';
  ls.innerHTML = `<option value="">${esc(t('cx.auto'))}</option>` +
    [{ id: 'tasks' }, ...S.lists].map(l =>
      `<option value="${l.id}"${l.id === cur ? ' selected' : ''}>${esc(l.id === 'tasks' ? t('nav.tasks') : l.name)}</option>`).join('');
  ls.dir = lang() === 'fa' ? 'rtl' : 'ltr';
}
/** Sync the visible option chips/selects with ui.composer state. */
function renderCx() {
  const c = ui.composer;
  // New composer UI - just update action buttons
  updateComposerActions();
}
function toggleComposerPanel(force) {
  const panel = $('#composerX');
  const open = force != null ? force : panel.hidden;
  panel.hidden = !open;
  $('#composerForm').classList.toggle('xopen', open);
}
function resetComposerOpts() {
  ui.composer = { due: null, time: '', repeat: null, important: false, listId: null };
  if ($('#cxEveryWrap')) $('#cxEveryWrap').hidden = true;
}

/* Composer popups */
function togglePopup(id) {
  const el = $('#' + id);
  if (!el) return;
  const wasHidden = el.hidden;
  closeAllPopups();
  if (wasHidden) el.hidden = false;
}
function closeAllPopups() {
  ['cxDuePopup', 'cxReminderPopup', 'cxRepeatPopup', 'cxListPopup'].forEach(id => {
    const el = $('#' + id);
    if (el) el.hidden = true;
  });
}
function updateDueHints() {
  const today = todayISO();
  const tmr = addDaysISO(today, 1);
  const nw = addDaysISO(today, 7);
  const pToday = formatDateParts(today, { shortMonth: true });
  const pTmr = formatDateParts(tmr, { shortMonth: true });
  const pNw = formatDateParts(nw, { shortMonth: true });
  const L = lang();
  const fmt = p => L === 'fa' ? `${p.j} ${p.jm}` : `${p.g} ${p.gm}`;
  if ($('#cxTodayHint')) $('#cxTodayHint').textContent = fmt(pToday);
  if ($('#cxTmrHint')) $('#cxTmrHint').textContent = fmt(pTmr);
  if ($('#cxNwHint')) $('#cxNwHint').textContent = fmt(pNw);
}
function buildRepeatSelect() {
  const sel = $('#cxRepeat');
  if (!sel) return;
  sel.innerHTML = REP_OPTS.map(([v, k]) => `<option value="${v}">${esc(t(k))}</option>`).join('');
  sel.value = ui.composer.repeat?.type || 'none';
  sel.onchange = () => {
    const v = sel.value;
    ui.composer.repeat = v === 'none' ? null : { type: v, every: v === 'custom' ? (+$('#cxEvery')?.value || 2) : (ui.composer.repeat?.every || 2) };
    if ($('#cxEveryWrap')) $('#cxEveryWrap').hidden = v !== 'custom';
    updateComposerActions();
  };
}
function buildListSelect() {
  const container = $('#cxListOptions');
  if (!container) return;
  const lists = [{ id: 'tasks', name: t('nav.tasks') }, ...S.lists];
  container.innerHTML = lists.map(l =>
    `<button type="button" class="c-popup-item${(ui.composer.listId || 'tasks') === l.id ? ' active' : ''}" data-list-id="${l.id}">${esc(l.name)}</button>`
  ).join('');
  container.querySelectorAll('.c-popup-item').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.composer.listId = btn.dataset.listId === 'tasks' ? null : btn.dataset.listId;
      closeAllPopups(); updateComposerActions();
    });
  });
}
function updateComposerActions() {
  const dueBtn = $('#cxDueBtn');
  const remBtn = $('#cxReminderBtn');
  const repBtn = $('#cxRepeatBtn');
  const listBtn = $('#cxListBtn');
  if (dueBtn) {
    const lbl = dueBtn.querySelector('.c-action-label');
    if (ui.composer.due) {
      const p = formatDateParts(ui.composer.due, { shortMonth: true });
      lbl.textContent = lang() === 'fa' ? `${p.j} ${p.jm}` : `${p.g} ${p.gm}`;
      dueBtn.classList.add('active');
    } else { lbl.textContent = t('cx.when'); dueBtn.classList.remove('active'); }
  }
  if (remBtn) {
    const lbl = remBtn.querySelector('.c-action-label');
    if (ui.composer.time) {
      lbl.textContent = ui.composer.time;
      remBtn.classList.add('active');
    } else { lbl.textContent = t('cx.alert'); remBtn.classList.remove('active'); }
  }
  if (repBtn) {
    const lbl = repBtn.querySelector('.c-action-label');
    if (ui.composer.repeat) {
      lbl.textContent = t('rep.' + ui.composer.repeat.type);
      repBtn.classList.add('active');
    } else { lbl.textContent = t('lbl.repeat'); repBtn.classList.remove('active'); }
  }
  if (listBtn) {
    const lbl = listBtn.querySelector('.c-action-label');
    const l = getList(ui.composer.listId);
    if (l) { lbl.textContent = l.name; listBtn.classList.add('active'); }
    else { lbl.textContent = t('cx.place'); listBtn.classList.remove('active'); }
  }
}
function buildMoveSel() {
  const sel = $('#moveSel');
  sel.innerHTML = [{ id: 'tasks' }, ...S.lists].map(l =>
    `<option value="${l.id}">${esc(l.id === 'tasks' ? t('nav.tasks') : l.name)}</option>`).join('');
  sel.dir = lang() === 'fa' ? 'rtl' : 'ltr';
}
function renderSteps() {
  const tk = byId(ui.drawerId); if (!tk) return;
  $('#stepList').innerHTML = tk.steps.map(s => `<li class="step${s.done ? ' done' : ''}" data-step-id="${s.id}">
    <button class="check" data-action="step-check" data-id="${s.id}" aria-label="${esc(t('a.toggleStep'))}"><svg viewBox="0 0 24 24"><use href="#i-check"/></svg></button>
    <span class="step-txt" data-action="step-edit" data-id="${s.id}">${esc(s.text)}</span>
    <button class="ibtn del-btn" data-action="step-del" data-id="${s.id}" aria-label="${esc(t('a.stepDel'))}"><svg><use href="#i-x"/></svg></button>
  </li>`).join('');
}
/** Update a single row's live bits after drawer edits (no full re-render). */
function updateTaskRow(id) {
  const tk = byId(id); if (!tk) return;
  const row = $(`#view .task[data-id="${id}"]`); if (!row) return;
  row.classList.toggle('done', tk.completed);
  row.classList.toggle('starred', tk.important);
  // Update priority classes
  row.classList.remove('pri-row-low', 'pri-row-medium', 'pri-row-high');
  if (tk.priority && tk.priority !== 'none') row.classList.add('pri-row-' + tk.priority);
  const starBtn = $('.star-btn', row); if (starBtn) starBtn.classList.toggle('on', tk.important);
  // Update priority button
  const priBtn = $('.pri-btn', row);
  if (priBtn) {
    const pri = tk.priority || 'none';
    priBtn.classList.remove('pri-on', 'pri-color-low', 'pri-color-medium', 'pri-color-high');
    if (pri !== 'none') { priBtn.classList.add('pri-on', 'pri-color-' + pri); }
  }
  const main = $('.t-main', row);
  const q = ui.search.trim();
  const titleEl = $('.t-title', row);
  titleEl.innerHTML = q ? highlight(tk.title, q) : esc(tk.title);
  const meta = $('.t-meta', row);
  const hasMeta = tk.due || tk.reminder || tk.notes.trim() || tk.steps.length || repeatsOn(tk);
  if (hasMeta) {
    if (meta) meta.innerHTML = metaChipsHTML(tk, { showList: false });
    else { const div = document.createElement('div'); div.className = 't-meta'; div.innerHTML = metaChipsHTML(tk, { showList: false }); main.appendChild(div); }
  } else if (meta) meta.remove();
}

/* ===================== 10. Date picker ===================== */
function openPicker({ taskId, field, valueIso, time }) {
  const base = valueIso || todayISO();
  const cal = S.settings.calendar === 'jalali' ? 'j' : 'g';
  let y, m;
  if (cal === 'g') { const g = parseISO(base); y = g.gy; m = g.gm - 1; }
  else { const j = jPart(base); y = j.jy; m = j.jm; }
  ui.pk = {
    cal, y, m, field, taskId,
    sel: valueIso || null,
    hasTime: field === 'reminder',
    time: time || '09:00',
  };
  $('#pkTimeWrap').hidden = !ui.pk.hasTime;
  $('#pkTime').value = ui.pk.time;
  syncPkSeg();
  openModal('#pickerRoot');
  renderPicker();
}
function closePicker() { closeModal('#pickerRoot'); ui.pk = null; }
function syncPkSeg() {
  if (!ui.pk) return;
  $('#pkCalG').classList.toggle('on', ui.pk.cal === 'g');
  $('#pkCalJ').classList.toggle('on', ui.pk.cal === 'j');
}
function pkShift(dir) {
  const pk = ui.pk; if (!pk) return;
  if (pk.cal === 'g') {
    let m = pk.m + dir, y = pk.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    pk.m = m; pk.y = y;
  } else {
    let m = pk.m + dir, y = pk.y;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    pk.m = m; pk.y = y;
  }
  renderPicker();
}
function renderPicker() {
  const pk = ui.pk; if (!pk) return;
  const L = lang(), ws = weekStart();
  const cells = [];
  let labelMain, labelSub;

  if (pk.cal === 'g') {
    const firstIso = isoFromG(pk.y, pk.m + 1, 1);
    const off = (weekdayOf(firstIso) - ws + 7) % 7;
    const start = addDaysISO(firstIso, -off);
    for (let i = 0; i < 42; i++) {
      const iso = addDaysISO(start, i);
      const g = parseISO(iso);
      cells.push({ iso, big: fmtNum(g.gd), sub: fmtNum(jPart(iso).jd), out: g.gm - 1 !== pk.m });
    }
    const jj = jPart(firstIso);
    labelMain = `${MONTHS_G[L][pk.m]}${pk.y !== new Date().getFullYear() ? ' ' + fmtY(pk.y) : ''}`;
    labelSub = `${MONTHS_J[L][jj.jm - 1]} ${fmtY(jj.jy)}`;
  } else {
    const len = jMonthLen(pk.y, pk.m);
    const firstIso = isoFromJ(pk.y, pk.m, 1);
    const off = (weekdayOf(firstIso) - ws + 7) % 7;
    const start = addDaysISO(firstIso, -off);
    for (let i = 0; i < 42; i++) {
      const iso = addDaysISO(start, i);
      const j = jPart(iso);
      const g = parseISO(iso);
      cells.push({ iso, big: fmtNum(j.jd), sub: fmtNum(g.gd), out: j.jm !== pk.m });
    }
    const lastG = parseISO(addDaysISO(firstIso, len - 1));
    const firstG = parseISO(firstIso);
    let gLabel = `${MONTHS_G_SHORT[L][firstG.gm - 1]} ${fmtY(firstG.gy)}`;
    if (lastG.gm !== firstG.gm) gLabel = `${MONTHS_G_SHORT[L][firstG.gm - 1]} – ${MONTHS_G_SHORT[L][lastG.gm - 1]} ${fmtY(lastG.gy)}`;
    labelMain = `${MONTHS_J[L][pk.m - 1]} ${fmtY(pk.y)}`;
    labelSub = gLabel;
  }

  $('#pkTitle').innerHTML = `${labelMain}<i>·</i><span class="pk-sub">${labelSub}</span>`;

  $('#pkWeek').innerHTML = Array.from({ length: 7 }, (_, i) => `<span>${WD_MIN[L][(ws + i) % 7]}</span>`).join('');
  const todayIso = todayISO();
  $('#pkGrid').innerHTML = cells.map(c =>
    `<button class="pk-cell${c.out ? ' out' : ''}${c.iso === todayIso ? ' today' : ''}${c.iso === pk.sel ? ' sel' : ''}" data-action="pk-cell" data-iso="${c.iso}">
      <b>${c.big}</b><small>${c.sub}</small></button>`).join('');
}
function commitPick(isoOrNull) {
  const pk = ui.pk; if (!pk) return;
  if (pk.field === 'cx-due') {                // composer due chip (no task yet)
    ui.composer.due = isoOrNull;
    closePicker();
    saveSoon(); renderCx();
    return;
  }
  const tk = pk.taskId ? byId(pk.taskId) : null;
  if (pk.field === 'due') {
    if (tk) { tk.due = isoOrNull; }
  } else if (pk.field === 'reminder') {
    if (tk) {
      tk.reminder = isoOrNull ? `${isoOrNull}T${$('#pkTime').value || '09:00'}` : null;
      tk.notified = false;
      requestNotifyPermission();
    }
  }
  closePicker();
  if (tk) {
    saveSoon();
    renderSidebar(); renderView(); refreshDrawerValues(); updateDocTitle();
  }
}
function requestNotifyPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
}

/* ===================== 11. Modals, popovers, menus ===================== */
function openModal(sel) { const m = $(sel); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
function closeModal(sel) { const m = $(sel); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }

function openConfirm({ title, body, yesLabel, onYes }) {
  $('#cfTitle').textContent = title;
  $('#cfBody').textContent = body;
  $('#cfYes').textContent = yesLabel || t('cf.delete');
  ui.confirmCb = onYes;
  openModal('#confirmRoot');
}

let popOpen = null;
function closePops() {
  if (popOpen) { popOpen.remove(); popOpen = null; }
  $('#settingsPop').hidden = true;
}
function positionPop(pop, rect) {
  document.body.appendChild(pop);
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = clampN(rect.left + rect.width / 2 - pw / 2, 10, innerWidth - pw - 10);
  let top = rect.top - ph - 8;
  if (top < 10) top = clampN(rect.bottom + 8, 10, innerHeight - ph - 10);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}
function openSettingsPop() {
  const pop = $('#settingsPop');
  pop.hidden = false;
  popOpen = null;
  syncSettingsUI();
}
function toggleSettingsPop() {
  const pop = $('#settingsPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  closePops();
  openSettingsPop();
}
function syncSettingsUI() {
  $$('.theme-card').forEach(b => b.classList.toggle('on', b.dataset.theme === S.settings.theme));
  $$('#modeSeg button').forEach(b =>
    b.classList.toggle('on', S.settings.autoTheme ? b.dataset.mode === 'auto' : b.dataset.mode === S.settings.mode));
  $$('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === S.settings.lang));
  $$('#calSeg button').forEach(b => b.classList.toggle('on', b.dataset.cal === S.settings.calendar));
  $$('#accentRow .sw').forEach(b => b.classList.toggle('on', (b.dataset.val || '') === (S.settings.accent || '')));
}

function openListMenu(listId, anchorRect) {
  closePops();
  const l = getList(listId); if (!l) return;
  const pop = document.createElement('div');
  pop.className = 'pop menu-pop';
  pop.innerHTML = `
    <form id="renameForm" data-id="${l.id}"><input maxlength="40" value="${esc(l.name)}" aria-label="${esc(t('a.rename'))}"></form>
    <div class="menu-colors">${LIST_COLORS.map(c =>
      `<button class="sw${c === l.color ? ' on' : ''}" data-color="${c}" style="background:var(--lc-${c})" data-action="list-color" data-id="${l.id}" aria-label="${c}"></button>`).join('')}
    </div>
    <div class="ic-row">${LIST_ICONS.map(ic =>
      `<button type="button" class="ic-sw${(l.icon || '') === ic ? ' on' : ''}${ic ? '' : ' letter'}" data-action="list-icon" data-id="${l.id}" data-icon="${ic}" aria-label="${ic || 'letter'}">${ic ? `<svg><use href="#${ic}"/></svg>` : `<span>Aa</span>`}</button>`).join('')}
    </div>
    <button class="menu-item" data-action="list-bg" data-id="${l.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>${esc(t('bg.title'))}</span></button>
    <button class="menu-item" data-action="list-print" data-id="${l.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg><span>${esc(t('list.print'))}</span></button>
    <button class="menu-item destructive" data-action="list-delete" data-id="${l.id}"><svg><use href="#i-trash"/></svg><span>${esc(t('list.delete'))}</span></button>`;
  positionPop(pop, anchorRect);
  popOpen = pop;
  const inp = $('input', pop);
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

/* Background picker */
let bgTarget = { type: null, id: null }; // { type: 'list'|'myday', id: string|null }
function openBackgroundPicker(type, id) {
  bgTarget = { type, id };
  const root = $('#bgRoot');
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  renderBgGrid();
}
function closeBackgroundPicker() {
  const root = $('#bgRoot');
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
}

/* Intelligent Suggestions for My Day */
function getSuggestions() {
  const today = todayISO();
  const suggestions = [];
  // 1. Overdue tasks
  S.tasks.filter(tk => !tk.completed && tk.due && tk.due < today && !tk.myDay)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 3).forEach(tk => suggestions.push({ tk, tag: 'suggest.overdue', tagCls: 'overdue' }));
  // 2. Today's tasks not in My Day
  S.tasks.filter(tk => !tk.completed && tk.due === today && !tk.myDay)
    .slice(0, 2).forEach(tk => suggestions.push({ tk, tag: 'chip.today', tagCls: 'today' }));
  // 3. Important tasks not in My Day
  S.tasks.filter(tk => !tk.completed && tk.important && !tk.myDay && !suggestions.some(s => s.tk.id === tk.id))
    .slice(0, 2).forEach(tk => suggestions.push({ tk, tag: 'suggest.important', tagCls: 'important' }));
  // 4. Old active tasks (no due date, created > 7 days ago)
  const weekAgo = addDaysISO(today, -7);
  S.tasks.filter(tk => !tk.completed && !tk.due && !tk.myDay && tk.createdAt < weekAgo && !suggestions.some(s => s.tk.id === tk.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 2).forEach(tk => suggestions.push({ tk, tag: 'suggest.old', tagCls: 'old' }));
  return suggestions.slice(0, 8);
}
function openSuggestions() {
  const panel = $('#suggestPanel');
  const list = $('#suggestList');
  const suggestions = getSuggestions();
  if (!suggestions.length) {
    list.innerHTML = `<div class="suggest-empty">${t('suggest.empty')}</div>`;
  } else {
    list.innerHTML = suggestions.map(s => `
      <div class="suggest-item" data-id="${s.tk.id}">
        <span class="suggest-tag ${s.tagCls}">${t(s.tag)}</span>
        <span class="suggest-item-title">${esc(s.tk.title)}</span>
        <button class="suggest-item-add" data-action="add-to-myday" data-id="${s.tk.id}" title="${t('tt.dMyday')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    `).join('');
  }
  panel.hidden = false;
}
function closeSuggestions() {
  $('#suggestPanel').hidden = true;
}
function addToMyDay(id) {
  const tk = byId(id);
  if (tk) {
    tk.myDay = true;
    saveSoon();
    persistAndRender();
    openSuggestions(); // refresh list
  }
}
function renderBgGrid() {
  const grid = $('#bgGrid');
  const currentBg = bgTarget.type === 'myday' ? localStorage.getItem(MYDAY_BG_KEY) : getList(bgTarget.id)?.bg?.value || '';
  grid.innerHTML = BG_GALLERY.map(bg =>
    `<button class="bg-swatch${currentBg === bg.value ? ' selected' : ''}" data-bg-value="${esc(bg.value)}" title="${esc(bg.name)}" style="background:${bg.value}"></button>`
  ).join('') +
    `<button class="bg-swatch" data-bg-value="" title="None" style="background:var(--surface);border:1.5px dashed var(--border);display:grid;place-items:center;font-size:1.2rem;color:var(--text3)">✕</button>`;
}
function applyBackground(value) {
  if (bgTarget.type === 'myday') {
    if (value) localStorage.setItem(MYDAY_BG_KEY, value);
    else localStorage.removeItem(MYDAY_BG_KEY);
  } else {
    const l = getList(bgTarget.id);
    if (l) {
      l.bg = value ? { type: 'gradient', value } : null;
    }
  }
  saveSoon();
  renderView();
  closeBackgroundPicker();
  toast(value ? t('bg.set') : t('bg.removed'));
}

/* ===================== 12. Toasts ===================== */
function toast(msg, opts = {}) {
  const host = $('#toastHost');
  const li = document.createElement('li');
  li.className = 'toast';
  li.innerHTML = `<svg><use href="#${opts.undo ? 'i-trash' : 'i-spark'}"/></svg><span>${msg}</span>${opts.undo ? `<button class="toast-undo" data-action="undo-toast" aria-label="${esc(t('undo'))}"><svg><use href="#i-undo"/></svg>${esc(t('undo'))}</button>` : ''}`;
  host.appendChild(li);
  while (host.children.length > 3) host.firstChild.remove();
  const kill = () => { li.classList.add('leaving'); setTimeout(() => li.remove(), 260); };
  li._kill = kill;
  setTimeout(kill, opts.undo ? 5200 : 3400);
}

/* ===================== 12b. Sound Effects ===================== */
const sfx = (() => {
  let ac = null;
  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    return ac;
  }
  function tone(f, d, type, g, t0) {
    const a = ctx(); if (!a) return;
    try {
      const o = a.createOscillator(), v = a.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      v.gain.setValueAtTime(0.0001, a.currentTime + t0);
      v.gain.linearRampToValueAtTime(g || .06, a.currentTime + t0 + .012);
      v.gain.exponentialRampToValueAtTime(.0001, a.currentTime + t0 + d);
      o.connect(v); v.connect(a.destination);
      o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + d + .05);
    } catch (e) {}
  }
  return {
    complete()    { if (!S.settings.sound) return; tone(660, .12, 'triangle', .055, 0); tone(880, .16, 'triangle', .045, .09); },
    add()         { if (!S.settings.sound) return; tone(540, .07, 'sine', .04, 0); },
    achievement() { if (!S.settings.sound) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, .15, 'triangle', .05, i * .09)); },
  };
})();

/* ===================== 12c. Streaks & Achievements ===================== */
function totalDone() { return Object.values(S.stats.completionsByDay).reduce((a, b) => a + b, 0); }
/** Consecutive completion days ending today (or yesterday if today is still open). */
function currentStreak() {
  const c = S.stats.completionsByDay;
  let d = todayISO();
  if (!c[d]) d = addDaysISO(d, -1);
  let n = 0;
  while (c[d]) { n++; d = addDaysISO(d, -1); }
  return n;
}
/** Longest run of consecutive days anywhere in history. */
function bestStreak() {
  const ks = Object.keys(S.stats.completionsByDay).sort();
  let best = 0, run = 0, prev = null;
  for (const k of ks) {
    run = (prev !== null && diffDays(prev, k) === 1) ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return Math.max(best, currentStreak());
}
function statCtx() {
  return {
    total: totalDone(), streak: currentStreak(), best: bestStreak(),
    lists: S.lists.length, flags: S.stats.flags,
  };
}
/** Unlock any newly-satisfied achievements; toast each one. Called from renderAll. */
function checkAchievements() {
  const ctx = statCtx();
  let changed = false;
  for (const a of ACHIEVEMENTS) {
    if (S.stats.achievements[a.id]) continue;
    let pass = false;
    try { pass = !!a.test(ctx); } catch (e) {}
    if (pass) {
      S.stats.achievements[a.id] = todayISO();
      changed = true;
      toast(`<b>${esc(t('ach.unlocked'))}:</b> ${esc(a.name[lang()])}`);
      sfx.achievement();
    }
  }
  if (changed) saveSoon();
}
/** Momentum popover: 28-day bar chart + records. */
function openMomentum(rect) {
  closePops();
  const pop = document.createElement('div');
  pop.className = 'pop mom-pop';
  const days = [];
  for (let i = 27; i >= 0; i--) {
    const iso = addDaysISO(todayISO(), -i);
    days.push({ iso, n: S.stats.completionsByDay[iso] || 0 });
  }
  const max = Math.max(1, ...days.map(d => d.n));
  const bars = days.map((d, i) => {
    const h = Math.max(3, d.n / max * 54);
    const x = 5 + i * 9.8;
    return `<rect x="${x.toFixed(1)}" y="${(66 - h).toFixed(1)}" width="6.5" height="${h.toFixed(1)}" rx="2" fill="var(--accent)" opacity="${d.iso === todayISO() ? 1 : .5}"><title>${d.iso}: ${fmtNum(d.n)}</title></rect>`;
  }).join('');
  pop.innerHTML = `
    <div class="pop-label">${esc(t('momentum.title'))}</div>
    <svg class="mom-svg" viewBox="0 0 282 72">${bars}
      <line x1="4" y1="66.8" x2="278" y2="66.8" stroke="var(--border-strong)" stroke-width="1"/></svg>
    <div class="mom-stats">
      <span><svg><use href="#i-flame"/></svg>${esc(t('mom.best'))}: <b>${fmtNum(bestStreak())}</b></span>
      <span><svg><use href="#i-check"/></svg>${esc(t('mom.total'))}: <b>${fmtNum(totalDone())}</b></span>
    </div>`;
  positionPop(pop, rect);
  popOpen = pop;
}
/** Achievements shelf modal. */
function openTrophy() {
  $('#badgeGrid').innerHTML = ACHIEVEMENTS.map(a => {
    const un = S.stats.achievements[a.id];
    return `<div class="badge-card${un ? ' on' : ' locked'}" title="${esc(un ? t('created.on', { date: ddText(un) }) : t('ach.locked'))}">
      <svg><use href="#${a.icon}"/></svg>
      <div class="badge-name">${esc(a.name[lang()])}</div>
      <div class="badge-desc">${esc(a.desc[lang()])}</div>
    </div>`;
  }).join('');
  openModal('#trophyRoot');
}

/* ===================== 12d. Confetti ===================== */
const confetti = (() => {
  const cvs = $('#confetti');
  const cx = cvs.getContext ? cvs.getContext('2d') : null;   // null in exotic environments
  let parts = [], running = false, dpr = 1;
  function size() {
    dpr = window.devicePixelRatio || 1;
    cvs.width = innerWidth * dpr; cvs.height = innerHeight * dpr;
    cx && cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', size);
  size();
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    return [cs.getPropertyValue('--accent').trim() || '#6552e6',
            cs.getPropertyValue('--accent2').trim() || '#1cb5f0',
            cs.getPropertyValue('--success').trim() || '#2fa96c',
            '#ffd166', '#ff7b92', '#ffffff'];
  }
  function tick() {
    if (!cx) { running = false; parts = []; return; }
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.t < p.life && p.y < innerHeight + 30);
    for (const p of parts) {
      p.vx *= .985; p.vy += .26; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.t++;
      const alpha = Math.min(1, Math.max(0, (p.life - p.t) / 22));
      cx.save(); cx.globalAlpha = alpha; cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      if (p.shape) { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, 7); cx.fill(); }
      else cx.fillRect(-p.s / 2, -p.s / 2.6, p.s, p.s * .76);
      cx.restore();
    }
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function burst(x, y, n = 130) {
    const cols = colors();
    for (let i = 0; i < n; i++) {
      parts.push({
        x, y,
        vx: (Math.random() - .5) * 15,
        vy: -Math.random() * 12 - 3.5,
        s: Math.random() * 7 + 4,
        r: Math.random() * Math.PI, vr: (Math.random() - .5) * .32,
        c: cols[Math.floor(Math.random() * cols.length)],
        shape: Math.random() < .45,
        life: 75 + Math.random() * 45, t: 0,
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
  return { burst: (x, y, n) => { if (cx) burst(x, y, n); } };
})();

/* ===================== 13. Drag & Drop ===================== */
const dnd = { active: null, base: null, win: null };

function onDragStart(e, id) {
  if (e.button !== undefined && e.button !== 0) return;
  const row = e.target.closest('.task');
  if (!row || row.classList.contains('done')) return;
  const scroller = $('#scroller');
  const rows = $$('#view .task:not(.done)').filter(r => r.closest('#view'));
  const items = rows.map(el => ({ el, top: el.getBoundingClientRect().top, h: el.offsetHeight }));
  const fromIndex = items.findIndex(it => it.el === row);
  if (fromIndex < 0) return;
  // virtualized list: remember the full id order + rendered window so the drop
  // can be translated back to a whole-list order (off-screen rows aren't in DOM)
  const vl = ui._vls && ui._vls.active;
  if (vl && !ui.search.trim()) { dnd.base = vl.tasks.map(t => t.id); dnd.win = vl.win.slice(); }
  else { dnd.base = null; dnd.win = null; }
  e.preventDefault();
  row.classList.add('dragging');
  document.body.classList.add('is-dragging');
  row.setPointerCapture?.(e.pointerId);
  dnd.active = {
    id, row, items, fromIndex, hoverIndex: fromIndex,
    startY: e.clientY, targetY: e.clientY, curY: e.clientY,
    pointerId: e.pointerId, raf: 0, lastClientY: e.clientY,
  };
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
  loop();
}
function loop() {
  const d = dnd.active; if (!d) return;
  d.curY += (d.targetY - d.curY) * 0.3;                    // spring-follow lag
  const dy = d.curY - d.startY;
  d.row.style.transform = `translateY(${dy}px)`;
  autoScroll(d);
  computeHover(d);
  shiftSiblings(d);
  d.raf = requestAnimationFrame(loop);
}
function autoScroll(d) {
  const sc = $('#scroller'), r = sc.getBoundingClientRect();
  const edge = 56, speed = 14;
  let ds = 0;
  if (d.lastClientY < r.top + edge) ds = -speed * ((r.top + edge - d.lastClientY) / edge);
  else if (d.lastClientY > r.bottom - edge) ds = speed * ((d.lastClientY - (r.bottom - edge)) / edge);
  if (ds) {
    const before = sc.scrollTop;
    sc.scrollTop += ds;
    d.startY -= (sc.scrollTop - before);                   // keep card glued to pointer
  }
}
function computeHover(d) {
  // Find the nearest insertion slot by comparing the dragged card's center
  // against each sibling's visual center (including its current shift).
  const mid = d.row.getBoundingClientRect().top + d.row.offsetHeight / 2;
  let best = d.fromIndex;
  for (let i = 0; i < d.items.length; i++) {
    if (i === d.fromIndex) continue;
    const it = d.items[i];
    const center = it.top + it.h / 2 + siblingShiftAmount(d, i);
    if (i > d.fromIndex && mid > center) best = Math.max(best, i);
    if (i < d.fromIndex && mid < center) best = Math.min(best, i);
  }
  d.hoverIndex = best;
}
function siblingShiftAmount(d, i) {
  const f = d.fromIndex, h = d.hoverIndex;
  if (f < h && i > f && i <= h) return -d.items[f].h;
  if (h < f && i >= h && i < f) return d.items[f].h;
  return 0;
}
function shiftSiblings(d) {
  d.items.forEach((it, i) => {
    if (i === d.fromIndex) return;
    const sh = siblingShiftAmount(d, i);
    it.el.style.transform = sh ? `translateY(${sh}px)` : '';
  });
}
function resetVisuals(d) {
  cancelAnimationFrame(d.raf);
  d.row.style.transform = '';
  d.items.forEach(it => { it.el.style.transform = ''; });
}
function cleanupListeners() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  document.body.classList.remove('is-dragging');
}
function finishDrag(commit) {
  const d = dnd.active; if (!d) return;
  dnd.active = null;
  resetVisuals(d);
  d.row.classList.remove('dragging');
  cleanupListeners();
  if (!commit || d.hoverIndex === d.fromIndex) return;
  const ids = d.items.map(it => it.el.dataset.id);
  const moved = ids.splice(d.fromIndex, 1)[0];
  ids.splice(d.hoverIndex, 0, moved);
  if (dnd.base) {
    // virtualized: splice the reordered on-screen slice back into the full order
    commitReorder(moved, translateDndOrder(dnd.base, ids, dnd.win[0], dnd.win[1]));
  } else {
    commitReorder(moved, ids);
  }
}
function onDragMove(e) {
  const d = dnd.active; if (!d) return;
  e.preventDefault();
  d.targetY = e.clientY; d.lastClientY = e.clientY;
}
function onDragEnd() { finishDrag(true); }
function onDragCancel() { finishDrag(false); }

/* ===================== 13b. List Virtualization =====================
   Approach: measured-height scroll model. Each row's real height is cached by
   task id the first time it renders; unknown rows use a running average estimate.
   Spacers above/below the rendered slice keep total scroll height stable, and
   after each fill we re-measure and correct once if estimates drifted.

   Tradeoff vs an IntersectionObserver/sentinel design: sentinels avoid manual
   offset math but need one observer per row (or complex grouping), make
   random-access jumps (deep scrollTop restore) awkward, and still require a
   height source to size spacers. The measured model keeps everything in plain
   arithmetic — binary search over prefix sums — at the cost of a one-frame
   correction pass when many unmeasured rows appear. For this app (re-render
   on state change, single scroll container) that trade is clearly better. */
const vstate = {
  est: 56,                    // running average estimate for unmeasured rows
  heights: new Map(),         // taskId -> last measured px height
  sum: 0, cnt: 0,             // for refining the estimate
};

/** Pure helper (unit-tested): splice a reordered on-screen slice back into the
    full id order of a virtualized list. */
function translateDndOrder(baseIds, localIds, ws, we) {
  return [...baseIds.slice(0, ws), ...localIds, ...baseIds.slice(we)];
}

function createVL(ul, spec, scroller, key) {
  const vl = {
    ul, tasks: spec.tasks, ctx: spec.ctx, key, scroller,
    tops: [], total: 0,
    win: [-1, -1],              // [start,end) of currently rendered slice
  };
  vl.hOf = tk => vstate.heights.get(tk.id) || vstate.est;
  vl.measure = function () {
    let y = 0;
    this.tops = this.tasks.map(t => { const yy = y; y += this.hOf(t); return yy; });
    this.total = y;
  };
  vl.lowerBound = function (y) {           // first index whose top >= y
    let lo = 0, hi = this.tops.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.tops[m] < y) lo = m + 1; else hi = m; }
    return lo;
  };
  vl.htmlFor = function (start, end) {
    const t = this.tops;
    const topPx = start < t.length ? t[start] : this.total;
    const endOff = end <= start ? topPx : (end >= t.length ? this.total : t[end]);
    return `<div class="vspacer" style="height:${Math.max(0, topPx)}px"></div>`
      + this.tasks.slice(start, end).map((tk, i) => taskRowHTML(tk, { ...this.ctx, i: start + i })).join('')
      + `<div class="vspacer" style="height:${Math.max(0, this.total - endOff)}px"></div>`;
  };
  vl.fill = function (depth = 0) {
    const vh = this.scroller.clientHeight || VIEW_FALLBACK;
    const viewTop = this.scroller.scrollTop - this.ul.offsetTop;
    let start = clampN(this.lowerBound(viewTop - OVERSCAN_PX), 0, this.tasks.length);
    let end = clampN(this.lowerBound(viewTop + vh + OVERSCAN_PX) + 1, 0, this.tasks.length);
    if (start === this.win[0] && end === this.win[1]) return;
    this.win = [start, end];
    this.ul.innerHTML = this.htmlFor(start, end);
    // measure what we just rendered; correct estimates, then refill once if drifted
    if (depth < 1) {
      let drifted = false;
      $$('.task', this.ul).forEach(el => {
        const h = el.offsetHeight, id = el.dataset.id;
        if (!h) return;
        if (vstate.heights.get(id) !== h) {
          if (!vstate.heights.has(id)) { vstate.sum += h; vstate.cnt++; vstate.est = Math.round(vstate.sum / vstate.cnt); }
          vstate.heights.set(id, h);
          drifted = true;
        }
      });
      if (drifted && this.tasks.length) { this.measure(); this.fill(depth + 1); }
    }
  };
  vl.maybeFill = function () {             // called from the scroll rAF handler
    const vh = this.scroller.clientHeight || VIEW_FALLBACK;
    const viewTop = this.scroller.scrollTop - this.ul.offsetTop;
    const s = this.lowerBound(viewTop - OVERSCAN_PX);
    const e = clampN(this.lowerBound(viewTop + vh + OVERSCAN_PX) + 1, 0, this.tasks.length);
    if (s !== this.win[0] || e !== this.win[1]) this.fill();
  };
  vl.measure();
  return vl;
}
/** Fill every queued virtual list after a full innerHTML render. */
function mountVirtualLists(viewEl) {
  for (const key in ui._pendVL) {
    const spec = ui._pendVL[key];
    if (!spec) continue;
    const el = viewEl.querySelector(`[data-vl="${key}"]`);
    if (!el) continue;
    const vl = createVL(el, spec, $('#scroller'), key);
    vl.fill();
    ui._vls[key] = vl;
  }
  ui._pendVL = {};
}
/** After adding/restoring a task in a huge list, bring its row on-screen. */
function ensureTaskVisible(id) {
  const vl = ui._vls && ui._vls.active;
  if (!vl) return;
  const idx = vl.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const y = vl.ul.offsetTop + vl.tops[idx];
  const sc = vl.scroller;
  if (y < sc.scrollTop + 60 || y > sc.scrollTop + sc.clientHeight - 90) {
    sc.scrollTop = Math.max(0, y - sc.clientHeight * 0.35);
  }
  // re-window synchronously: the scroll event may lag one frame, and the new
  // row must exist in the DOM right now (entrance flash depends on it too)
  vl.win = [-1, -1];
  vl.fill();
}
function bindVirtualEvents() {
  let raf = 0;
  $('#scroller').addEventListener('scroll', () => {
    if (dnd.active) return;                 // window stays frozen mid-drag
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; for (const k in ui._vls) ui._vls[k].maybeFill(); });
  }, { passive: true });
  let rz;
  window.addEventListener('resize', () => { // width changes re-wrap text -> remeasure
    clearTimeout(rz);
    rz = setTimeout(() => {
      vstate.heights.clear();
      for (const k in ui._vls) { const v = ui._vls[k]; v.measure(); v.win = [-1, -1]; v.fill(); }
    }, 180);
  });
}
/** Dev/testing helper: generate N synthetic tasks in the default Tasks list. */
function seedBulk(n) {
  n = clampN(n | 0, 1, 5000);
  const T = todayISO();
  for (let i = 1; i <= n; i++) {
    S.tasks.push({
      id: uid(), listId: 'tasks', title: `Generated task ${i}`, notes: '',
      steps: i % 7 === 0 ? [{ id: uid(), text: 'substep', done: i % 14 === 0 }] : [],
      completed: i % 23 === 0, completedAt: i % 23 === 0 ? T : null,  // backfill only; not counted in stats
      important: i % 10 === 0, myDay: false,
      due: i % 97 === 0 ? addDaysISO(T, (i % 30) - 10) : null,
      reminder: null, repeat: null, notified: false,
      order: ++S.seq, createdAt: T,
    });
  }
  saveSoon();
  persistAndRender();
  return n;
}

/* ===================== 14. Completion Flow ===================== */
function onToggleComplete(id, btn) {
  const tk = byId(id); if (!tk || tk._busy) return;
  if (!tk.completed && isBlocked(tk)) {
    const blockers = tk.dependsOn.map(did => { const dt = getTask(did); return dt ? dt.title : ''; }).filter(Boolean).join(', ');
    toast(t('dep.cannotComplete', { tasks: esc(blockers) }));
    return;
  }
  if (!tk.completed) {
    tk._busy = true;
    const rowEl = btn.closest('.task');
    rowEl?.classList.add('completing');
    setTimeout(() => {
      const wasLast = willCompleteList(tk);
      delete tk._busy;
      tk.completed = true;
      tk.completedAt = todayISO();
      // stats: completions per day drive the streak, momentum chart and achievements
      S.stats.completionsByDay[tk.completedAt] = (S.stats.completionsByDay[tk.completedAt] || 0) + 1;
      const hr = new Date().getHours();
      if (hr < 8) S.stats.flags.earlybird = true;
      if (hr >= 22) S.stats.flags.nightowl = true;
      sfx.complete();
      let spawned = null;
      if (repeatsOn(tk)) spawned = spawnRepetition(tk);
      saveSoon();
      renderAll();
      if (wasLast && !ui.search.trim()) {
        S.stats.flags.allclear = true;
        const r = $('.task[data-id="' + id + '"] .check');
        const rect = (r || document.body).getBoundingClientRect();
        confetti.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 140);
        toast(t('stats.done', { a: fmtNum(ui._stats.total), b: fmtNum(ui._stats.total) }));
      }
      if (spawned) toast(t('toast.repeated', { date: ddText(spawned.due) }), {});
    }, 620);
  } else {
    tk.completed = false;
    if (tk.completedAt && S.stats.completionsByDay[tk.completedAt]) {
      S.stats.completionsByDay[tk.completedAt] = Math.max(0, S.stats.completionsByDay[tk.completedAt] - 1);
    }
    tk.completedAt = null;
    saveSoon();
    ui._flash = [id];
    renderAll();
  }
}
function willCompleteList(tk) {
  if (!matchesView(tk)) return false;
  const { active } = tasksForView();
  return active.filter(x => !x.completed && x.id !== tk.id).length === 0 && active.length >= 1;
}

/* ===================== 15. Reminders ===================== */
function tickReminders() {
  const now = Date.now();
  let changed = false;
  for (const tk of S.tasks) {
    if (tk.completed || !tk.reminder || tk.notified) continue;
    const ts = Date.parse(tk.reminder);
    if (!Number.isNaN(ts) && ts <= now) {
      tk.notified = true; changed = true;
      toast(t('toast.reminder', { title: esc(tk.title) }));
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(tk.title, { body: `${listName(tk.listId)} · ${ddText(tk.reminder.split('T')[0])}` });
        }
      } catch (e) {}
    }
  }
  if (changed) saveSoon();
}

/* ===================== 16. Settings Application ===================== */
function applyI18nStatic() {
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $('#composerInput').placeholder =
    ui.view === 'myday' ? t('ph.myDay')
    : ui.view === 'calendar' && ui.calSel
      ? t('ph.onDay', { d: formatDateParts(ui.calSel)[S.settings.calendar === 'jalali' ? 'j' : 'g'] })
      : t('ph.addTask');
  $('#btnLang').textContent = lang() === 'fa' ? 'EN' : 'فا';
  renderCx();
}
/** Effective light/dark: manual, or sun-based when Auto is on (6:30–19:00 ≈ daylight). */
function effectiveMode() {
  if (!S.settings.autoTheme) return S.settings.mode;
  const h = new Date().getHours();
  return (h >= 6 && h < 19) ? 'light' : 'dark';
}
function applySettingsToDOM() {
  const de = document.documentElement;
  de.dataset.theme = S.settings.theme;
  de.dataset.mode = effectiveMode();
  de.dataset.lang = S.settings.lang;
  de.dataset.snd = S.settings.sound ? '1' : '0';
  de.lang = S.settings.lang;
  de.dir = S.settings.lang === 'fa' ? 'rtl' : 'ltr';
  console.log('[Planer] Applying settings:', { theme: S.settings.theme, mode: effectiveMode(), lang: S.settings.lang });
  // Custom accent override (inline custom properties win over theme tokens)
  const rs = de.style;
  if (S.settings.accent) {
    rs.setProperty('--accent', S.settings.accent);
    const a2 = getComputedStyle(de).getPropertyValue('--accent2').trim() || '#8888aa';
    rs.setProperty('--grad', `linear-gradient(135deg,${S.settings.accent},${a2})`);
  } else {
    rs.removeProperty('--accent');
    rs.removeProperty('--grad');
  }
  // keep the PWA title-bar / status-bar tint in sync with the active theme
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.setAttribute('content', getComputedStyle(de).getPropertyValue('--bg').trim() || '#6552e6');
  applyI18nStatic();
}
function setSetting(key, val) {
  S.settings[key] = val;
  saveSoon();
  applySettingsToDOM();
  if (key === 'lang') { buildRepSel(); buildMoveSel(); buildCxSelects(); }
  // text metrics change with language/theme -> row height cache must relearn
  if (key === 'lang' || key === 'theme' || key === 'calendar') vstate.heights.clear();
  renderAll();
  if (ui.pk) renderPicker();
  syncSettingsUI();
}

/* ===================== 16b. Natural Language Input =====================
   Understands dates, times, !important and #lists in English & Persian.
   Returns {title, important?, listId?, due?, reminder?, repeat?} — matched
   tokens are stripped from the title. */
function normalizeDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
function parseQuickAdd(raw) {
  let s = ' ' + normalizeDigits(raw) + ' ';
  const patch = {};
  const T = todayISO();

  // importance: !important / !imp / !مهم
  s = s.replace(/\s*!(?:important|imp|مهم)\b/gi, () => { patch.important = true; return ' '; });

  // #list — matches an existing custom list or the built-in Tasks
  const hm = s.match(/\s#([^\s#]+)/);
  if (hm) {
    const q = hm[1].toLowerCase().replace(/\u200c/g, '');
    const li = S.lists.find(l => l.name.toLowerCase().replace(/\u200c/g, '').includes(q)) || null;
    if (li) { patch.listId = li.id; s = s.replace(hm[0], ' '); }
    else if ('tasks'.startsWith(q) || 'کارها'.includes(hm[1])) { patch.listId = 'tasks'; s = s.replace(hm[0], ' '); }
  }

  // recurrence (before date words so “هر ۳ روز” isn’t read as a date offset)
  const reps = [
    [/\s*(?:every\s*day|everyday|daily|هر\s*روز)\s*/i, { type: 'daily' }],
    [/\s*(?:every\s*week|weekly|هر\s*هفته)\s*/i, { type: 'weekly' }],
    [/\s*(?:every\s*month|monthly|هر\s*ماه)\s*/i, { type: 'monthly' }],
    [/\s*(?:every\s*year|yearly|هر\s*سال)\s*/i, { type: 'yearly' }],
  ];
  for (const [re, r] of reps) {
    const m = s.match(re);
    if (m) { patch.repeat = r; s = s.replace(m[0], ' '); break; }
  }
  const cm = s.match(/\b(?:every|each)\s+(\d{1,3})\s*days?\b/i) || s.match(/هر\s*(\d{1,3})\s*روز\S*/i);
  if (cm && !patch.repeat) { patch.repeat = { type: 'custom', every: clampN(+cm[1], 2, 365) }; s = s.replace(cm[0], ' '); }

  // time → reminder (17:00 / 5pm / 5 pm)
  const tm = s.match(/\b(\d{1,2})[:٫](\d{2})\b/) || s.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (tm) {
    let hh, mm;
    if (tm[2] !== undefined && /^\d{1,2}$/.test(tm[2])) { hh = +tm[1]; mm = +tm[2]; }        // HH:MM
    else if (/^[a-z]+$/i.test(tm[2] || '')) {                                                // H am/pm
      hh = +tm[1]; mm = 0;
      if (/pm/i.test(tm[2]) && hh < 12) hh += 12;
      if (/am/i.test(tm[2]) && hh === 12) hh = 0;
    } else { hh = NaN; mm = NaN; }
    if (Number.isFinite(hh) && hh < 24 && Number.isFinite(mm) && mm < 60) {
      patch.time = `${pad2(hh)}:${pad2(mm)}`;
      s = s.replace(tm[0], ' ');
    }
  }

  // date words
  let due = null;
  const datePats = [
    [/\s(?:today|امروز)(?=\s|$)/i, () => T],
    [/\s(?:tomorrow|tmr|فردا)(?=\s|$)/i, () => addDaysISO(T, 1)],
    [/\sپس[\u200c\s]?فردا(?=\s|$)/, () => addDaysISO(T, 2)],
    [/\s(?:next week|هفته\s*بعد|هفتهٔ?\s*دیگر)(?=\s|$)/i, () => addDaysISO(T, 7)],
    [/\sin\s+(\d{1,3})\s*days?\b/i, m => addDaysISO(T, +m[1])],
    [/\s(\d{1,3})\s*روز\s*(?:بعد|دیگر)\b/i, m => addDaysISO(T, +m[1])],
  ];
  for (const [re, fn] of datePats) {
    const m = s.match(re);
    if (m) { due = fn(m); if (due) s = s.replace(m[0], ' '); break; }
  }
  // weekday names → next occurrence
  if (due == null) {
    const we = s.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    const wf = s.match(/(شنبه|یکشنبه|دوشنبه|سه[\u200c ]?شنبه|چهارشنبه|پنجشنبه|جمعه)/);
    let target = null;
    if (we) {
      target = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[we[1].toLowerCase()];
      s = s.replace(we[0], ' ');
    } else if (wf) {
      const nm = wf[1].replace(/[\u200c\s]/g, '');
      target = { 'شنبه': 6, 'یکشنبه': 0, 'دوشنبه': 1, 'سهشنبه': 2, 'چهارشنبه': 3, 'پنجشنبه': 4, 'جمعه': 5 }[nm];
      if (target != null) s = s.replace(wf[0], ' ');
    }
    if (target != null) {
      let delta = (target - weekdayOf(T) + 7) % 7;
      if (delta === 0) delta = 7;
      due = addDaysISO(T, delta);
    }
  }
  if (due) patch.due = due;
  if (patch.time) patch.reminder = `${patch.due || T}T${patch.time}`;

  patch.title = s.replace(/\s+/g, ' ').trim();
  return patch;
}

/* ===================== 16c. View Switching & Commands ===================== */
function selectView(key) {
  ui.view = key;
  S.settings.lastView = key;
  if (key === 'calendar') {
    const t0 = parseISO(todayISO());
    ui.cal = { y: t0.gy, m: t0.gm - 1 };
    ui.calSel = todayISO();
  }
  clearSel();
  ui.search = ''; setSearchBox('');
  ui._enter = true;
  saveSoon(); renderAll(); applyI18nStatic();
  document.body.classList.remove('side-open');
}

function palItems(q) {
  q = (q || '').trim().toLowerCase();
  const it = [];
  SMART.forEach(s => it.push({ icon: s.icon, label: t('nav.' + s.id), run: () => { closePalette(); selectView(s.id); } }));
  S.lists.forEach(l => it.push({
    html: `<span class="avatar sm" data-color="${l.color}">${esc((l.name.trim()[0] || '?').toUpperCase())}</span>`,
    label: l.name, sub: t('sec.lists'),
    run: () => { closePalette(); selectView('list:' + l.id); },
  }));
  it.push({ icon: 'i-plus', label: t('sc.new'), run: () => { closePalette(); $('#composerInput').focus(); } });
  it.push({ icon: 'i-cal', label: `${t('pk.today')} — ${t('nav.calendar')}`, run: () => { closePalette(); selectView('calendar'); } });
  it.push({ icon: effectiveMode() === 'dark' ? 'i-sun' : 'i-moon', label: t('tt.mode'), run: () => { closePalette(); setSetting('mode', effectiveMode() === 'dark' ? 'light' : 'dark'); } });
  it.push({ icon: 'i-kbd', label: t('tt.shortcuts'), run: () => { closePalette(); openModal('#shortcutsRoot'); } });
  let f = it.filter(x => !q || x.label.toLowerCase().includes(q));
  if (q) searchTasks(q).slice(0, 7).forEach(tk =>
    f.push({ icon: 'i-clip', label: tk.title, sub: listName(tk.listId), run: () => { closePalette(); openDrawer(tk.id); } }));
  return f.slice(0, 14);
}
function renderPal() {
  const q = $('#palInput') ? $('#palInput').value : '';
  ui.pal.items = palItems(q);
  ui.pal.idx = clampN(ui.pal.idx, 0, Math.max(0, ui.pal.items.length - 1));
  $('#palList').innerHTML = ui.pal.items.length
    ? ui.pal.items.map((x, i) => `<li class="pal-item${i === ui.pal.idx ? ' on' : ''}" data-action="pal-run" data-i="${i}">
        ${x.html || `<svg><use href="#${x.icon}"/></svg>`}<span class="lbl">${esc(x.label)}</span>${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ''}</li>`).join('')
    : `<li class="pal-item empty">${esc(t('cmd.empty'))}</li>`;
}
function openPalette() {
  openModal('#paletteRoot');
  $('#palInput').value = '';
  ui.pal = { items: [], idx: 0 };
  renderPal();
  setTimeout(() => $('#palInput').focus(), 40);
}
function closePalette() { closeModal('#paletteRoot'); }

/* ===================== 16d. Bulk Actions ===================== */
function toggleSel(id) {
  if (ui.sel.has(id)) ui.sel.delete(id); else ui.sel.add(id);
  const row = $(`#view .task[data-id="${id}"]`);
  row?.classList.toggle('selected', ui.sel.has(id));
  renderBulkBar();
}
function clearSel() {
  if (!ui.sel.size) return;
  ui.sel.clear();
  renderBulkBar();
}
function renderBulkBar() {
  const b = $('#bulkBar'); if (!b) return;
  b.hidden = !ui.sel.size;
  if (ui.sel.size) {
    $('#bulkCount').textContent = t('bulk.sel', { n: fmtNum(ui.sel.size) });
    const ms = $('#bulkMoveSel');
    ms.innerHTML = [{ id: 'tasks' }, ...S.lists].map(l =>
      `<option value="${l.id}">${esc(l.id === 'tasks' ? t('nav.tasks') : l.name)}</option>`).join('');
    ms.dir = lang() === 'fa' ? 'rtl' : 'ltr';
  }
}

/* ===================== 16e. Swipe Gestures ===================== */
function startSwipe(e, row) {
  if (!row.dataset.id) return;
  const startX = e.clientX, startY = e.clientY;
  let engaged = false, dx = 0, lpFired = false;
  const lpTimer = setTimeout(() => {           // long-press enters selection mode
    lpFired = true;
    try { navigator.vibrate && navigator.vibrate(15); } catch (err) {}
    toggleSel(row.dataset.id);
    cleanup(false);
  }, 500);
  function suppressNextClick() {
    const once = ev => { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', once, true); };
    document.addEventListener('click', once, true);
    setTimeout(() => document.removeEventListener('click', once, true), 400);
  }
  function move(ev) {
    const dxc = ev.clientX - startX, dyc = ev.clientY - startY;
    if (!engaged) {
      if (Math.abs(dxc) > 14 && Math.abs(dxc) > Math.abs(dyc) * 1.4) {
        engaged = true; clearTimeout(lpTimer);
        row.classList.add('swiping');
      } else if (Math.abs(dyc) > 12) { cleanup(false); return; }
      else return;
    }
    dx = clampN(dxc, -120, 120);
    row.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('sw-right', dx > 60);
    row.classList.toggle('sw-left', dx < -60);
  }
  function up() {
    cleanup(true);
    if (!engaged) return;
    row.classList.remove('swiping', 'sw-right', 'sw-left');
    const id = row.dataset.id;
    if (dx > 80) {                              // right → complete
      row.style.transform = '';
      suppressNextClick();
      onToggleComplete(id, row.querySelector('.check'));
    } else if (dx < -80) {                      // left → delete
      row.style.transform = '';
      suppressNextClick();
      animateRemove(row, () => { removeTask(id); persistAndRender(); });
    } else {                                    // spring back
      row.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)';
      row.style.transform = '';
      setTimeout(() => { row.style.transition = ''; }, 260);
    }
  }
  function cleanup(clearLp) {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (clearLp) clearTimeout(lpTimer);
  }
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
}

/* ===================== 16f. Calendar Drag ===================== */
function startCalDrag(e, chip) {
  const taskId = chip.dataset.task;
  const task = byId(taskId);
  if (!task) return;
  const startX = e.clientX, startY = e.clientY;
  let engaged = false, ghost = null;
  const cellAt = (x, y) =>
    (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [])
      .find(n => n.classList && n.classList.contains('cal-cell'));
  function move(ev) {
    if (!engaged) {
      if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
        engaged = true;
        ghost = chip.cloneNode(true);
        ghost.className = 'cal-ghost';
        document.body.appendChild(ghost);
      } else return;
    }
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top = ev.clientY + 'px';
    $$('.cal-cell.over').forEach(c => c.classList.remove('over'));
    const el = cellAt(ev.clientX, ev.clientY);
    if (el && el.dataset.iso !== task.due) el.classList.add('over');
  }
  function up(ev) {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!engaged) return;                        // plain tap: native click opens drawer
    window._calDragMovedAt = performance.now();
    ghost?.remove();
    $$('.cal-cell.over').forEach(c => c.classList.remove('over'));
    const el = cellAt(ev.clientX, ev.clientY);
    if (el && el.dataset.iso && el.dataset.iso !== task.due) {
      task.due = el.dataset.iso;                 // reschedule by dropping on another day
      saveSoon();
      renderAll();
    }
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ===================== 17. Event Wiring ===================== */
/* ===================== 17b. Event Wiring (continued) ===================== */
function wireEvents() {
  wireClickDelegation();
  wireOutsideClick();
  wireComposer();
}

/* --- Click Delegation (dynamic content) --- */
function wireClickDelegation() {
  document.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      /* navigation */
      case 'select-view': selectView(actionEl.dataset.view); break;
      /* calendar month grid */
      case 'cal-pick': {
        ui.calSel = actionEl.dataset.iso;
        saveSoon(); renderView(); applyI18nStatic();
        break;
      }
      case 'cal-nav': {
        const dir = Number(actionEl.dataset.dir);
        if (dir === 0) {                       // "Today" — jump to current month/day
          const t0 = parseISO(todayISO());
          ui.cal = { y: t0.gy, m: t0.gm - 1 };
          ui.calSel = todayISO();
        } else {
          let m = ui.cal.m + dir, y = ui.cal.y;
          if (m < 0) { m = 11; y--; }
          if (m > 11) { m = 0; y++; }
          ui.cal = { y, m };
        }
        renderView(); applyI18nStatic();
        break;
      }
      case 'cal-ev': {                         // chip tap opens task; drags suppress this
        if (performance.now() - (window._calDragMovedAt || 0) < 250) break;
        openDrawer(actionEl.dataset.task);
        break;
      }

      /* streak / achievements */
      case 'open-momentum': closePops(); openMomentum(actionEl.getBoundingClientRect()); break;

      /* overdue rescue bar */
      case 'rescue-move': {
        const T0 = todayISO();
        S.tasks.forEach(x => { if (!x.completed && x.due && x.due < T0) x.due = T0; });
        toast(t('toast.moved', { list: t('nav.myday') }));
        persistAndRender();
        break;
      }
      case 'rescue-dismiss': ui.rescueDismissed = true; renderView(); break;

      /* accent color picker */
      case 'set-accent': setSetting('accent', actionEl.dataset.val || ''); break;

      /* composer option chips */
      case 'cx-due':
        openPicker({ field: 'cx-due', valueIso: ui.composer.due });
        break;
      case 'cx-quick': {
        const qk = actionEl.dataset.q;
        ui.composer.due = qk === 'today' ? todayISO()
          : qk === 'tomorrow' ? addDaysISO(todayISO(), 1)
          : addDaysISO(todayISO(), 7);            // nextweek
        saveSoon(); renderCx();
        break;
      }
      case 'cx-clear':
        ui.composer.due = null; ui.composer.time = ''; ui.composer.repeat = null;
        $('#cxTime').value = '';
        saveSoon(); renderCx();
        break;
      case 'cx-star':
        ui.composer.important = !ui.composer.important;
        renderCx();
        break;

      /* list icon picker (kebab menu) */
      case 'list-icon': {
        const l = getList(actionEl.dataset.id); if (!l) break;
        l.icon = actionEl.dataset.icon || '';
        $$('[data-action="list-icon"]').forEach(x => x.classList.toggle('on', (x.dataset.icon || '') === l.icon));
        saveSoon(); renderSidebar(); renderView();
        if (ui.drawerId && byId(ui.drawerId)?.listId === l.id) buildMoveSel();
        break;
      }

      /* command palette */
      case 'pal-run': { const itm = ui.pal.items[+actionEl.dataset.i]; itm?.run(); break; }

      /* bulk actions */
      case 'bulk-complete': {
        [...ui.sel].forEach(id => {
          const tk = byId(id);
          if (tk && !tk.completed) {
            tk.completed = true; tk.completedAt = todayISO();
            S.stats.completionsByDay[tk.completedAt] = (S.stats.completionsByDay[tk.completedAt] || 0) + 1;
            const hr = new Date().getHours();
            if (hr < 8) S.stats.flags.earlybird = true;
            if (hr >= 22) S.stats.flags.nightowl = true;
          }
        });
        clearSel(); sfx.complete(); persistAndRender();
        break;
      }
      case 'bulk-delete': {
        S.tasks = S.tasks.filter(x => !ui.sel.has(x.id));
        ui.lastRemoved = null;
        clearSel(); persistAndRender();
        break;
      }
      case 'bulk-cancel': clearSel(); renderView(); break;

      /* task rows */
      case 'open-task': {
        const rid = actionEl.dataset.id;
        if (e.ctrlKey || e.metaKey || (ui.sel.size && !e.target.closest('.check,.ibtn'))) { toggleSel(rid); break; }
        openDrawer(rid);
        break;
      }
      case 'toggle-complete': e.stopPropagation(); onToggleComplete(actionEl.dataset.id, actionEl); break;
      case 'star-row': {
        e.stopPropagation();
        const tk = byId(actionEl.dataset.id); if (!tk) break;
        tk.important = !tk.important;
        saveSoon(); renderSidebar(); renderView();
        if (ui.drawerId === tk.id) refreshDrawerValues();
        break;
      }
      case 'cycle-pri': {
        e.stopPropagation();
        const PRI_SEQ = ['none', 'low', 'medium', 'high'];
        const tk = byId(actionEl.dataset.id); if (!tk) break;
        const cur = PRI_SEQ.indexOf(tk.priority || 'none');
        tk.priority = PRI_SEQ[(cur + 1) % PRI_SEQ.length];
        saveSoon(); updateTaskRow(tk.id);
        if (ui.drawerId === tk.id) refreshDrawerValues();
        break;
      }
      case 'del-row': {
        e.stopPropagation();
        const id = actionEl.dataset.id;
        const row = actionEl.closest('.task');
        animateRemove(row, () => { removeTask(id); if (ui.drawerId === id) closeDrawer(); persistAndRender(); });
        break;
      }
      case 'chip-due': {
        e.stopPropagation();
        const tk = byId(actionEl.dataset.id); if (!tk) break;
        openPicker({ taskId: tk.id, field: 'due', valueIso: tk.due });
        break;
      }
      /* completed section */
      case 'comp-toggle': {
        ui.compCollapsed[ui.view] = !ui.compCollapsed[ui.view];
        const sec = actionEl.closest('.comp');
        sec.classList.toggle('closed', ui.compCollapsed[ui.view]);
        actionEl.setAttribute('aria-expanded', String(!ui.compCollapsed[ui.view]));
        break;
      }
      case 'comp-clear': clearCompletedInView(); break;

      /* steps */
      case 'step-check': {
        const tk = byId(ui.drawerId); if (!tk) break;
        const st = tk.steps.find(s => s.id === actionEl.dataset.id); if (!st) break;
        st.done = !st.done;
        saveSoon(); renderSteps(); updateTaskRow(tk.id);
        break;
      }
      case 'step-del': {
        const tk = byId(ui.drawerId); if (!tk) break;
        tk.steps = tk.steps.filter(s => s.id !== actionEl.dataset.id);
        saveSoon(); renderSteps(); updateTaskRow(tk.id);
        break;
      }
      case 'step-edit': {
        const tk = byId(ui.drawerId); if (!tk) break;
        const st = tk.steps.find(s => s.id === actionEl.dataset.id); if (!st) break;
        const span = actionEl;
        if (span.querySelector('input')) break;
        const input = document.createElement('input');
        input.value = st.text; input.maxLength = 200;
        span.textContent = ''; span.appendChild(input);
        input.focus(); input.select();
        let doneEd = false;
        const commitEd = ok => {
          if (doneEd) return; doneEd = true;
          if (ok && input.value.trim()) st.text = input.value.trim();
          saveSoon(); renderSteps(); updateTaskRow(tk.id);
        };
        input.addEventListener('blur', () => commitEd(true));
        input.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') commitEd(true);
          if (ev.key === 'Escape') commitEd(false);
        });
        break;
      }

      /* lists */
      case 'list-menu': {
        e.stopPropagation();
        closePops();
        openListMenu(actionEl.dataset.id, actionEl.getBoundingClientRect());
        break;
      }
      case 'list-color': {
        const l = getList(actionEl.dataset.id); if (l) { l.color = actionEl.dataset.color; saveSoon(); renderSidebar(); renderView(); }
        closePops();
        break;
      }
      case 'list-delete': {
        const l = getList(actionEl.dataset.id); if (!l) break;
        closePops();
        openConfirm({
          title: t('cf.list.title'),
          body: t('cf.list.body', { name: l.name }),
          onYes: () => { deleteList(l.id); persistAndRender(); },
        });
        break;
      }
      case 'list-bg': {
        const lid = actionEl.dataset.id;
        closePops();
        openBackgroundPicker('list', lid);
        break;
      }
      case 'myday-bg': {
        openBackgroundPicker('myday', null);
        break;
      }
      case 'open-suggestions': {
        openSuggestions();
        break;
      }
      case 'add-to-myday': {
        e.stopPropagation();
        addToMyDay(actionEl.dataset.id);
        break;
      }
      case 'toggle-group': {
        toggleGroup(actionEl.dataset.id);
        break;
      }
      case 'list-print': {
        closePops();
        window.print();
        break;
      }

      /* settings popover controls */
      case 'set-theme': setSetting('theme', actionEl.dataset.theme); break;
      case 'set-mode':
        if (actionEl.dataset.mode === 'auto') setSetting('autoTheme', true);
        else { if (S.settings.autoTheme) { S.settings.autoTheme = false; saveSoon(); } setSetting('mode', actionEl.dataset.mode); }
        break;
      case 'set-lang': setSetting('lang', actionEl.dataset.lang); break;
      case 'set-cal': setSetting('calendar', actionEl.dataset.cal); break;

      /* picker */
      case 'pk-cell': {
        const iso = actionEl.dataset.iso;
        if (ui.pk) { ui.pk.sel = iso; if (ui.pk.hasTime) { renderPicker(); } commitPick(iso); }
        break;
      }
      case 'pk-quick': {
        const qk = actionEl.dataset.q;
        const map = { clear: null, yesterday: addDaysISO(todayISO(), -1), today: todayISO(), tomorrow: addDaysISO(todayISO(), 1) };
        commitPick(map[qk]);
        break;
      }

      /* toasts */
      case 'undo-toast': {
        const btn = actionEl;
        const toastEl = btn.closest('.toast');
        undoRemove();
        toastEl?._kill?.();
        break;
      }
    }
  });

  /* per-view sort selector */
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    if (el.dataset.change === 'sort-sel') {
      S.settings.sortModes = S.settings.sortModes || {};
      S.settings.sortModes[ui.view] = el.value;
      saveSoon(); renderView();
    }
    if (el.dataset.change === 'group-sel') {
      S.settings.groupModes = S.settings.groupModes || {};
      S.settings.groupModes[ui.view] = el.value;
      saveSoon(); renderView();
    }
  });

  /* rename form (inside dynamic popover) */
  document.addEventListener('submit', e => {
    if (e.target.id === 'renameForm') {
      e.preventDefault();
      const l = getList(e.target.dataset.id);
      const val = $('input', e.target).value.trim();
      if (l && val) { l.name = val; saveSoon(); renderSidebar(); renderView(); }
      closePops();
    }
  });

  /* pointerdown on the view: reorder handles, calendar chip drag, touch swipes */
  $('#view').addEventListener('pointerdown', e => {
    const h = e.target.closest('.drag-handle');
    if (h) { onDragStart(e, h.closest('.task')?.dataset.id); return; }
    const chip = e.target.closest('.cal-ev');
    if (chip) { startCalDrag(e, chip); return; }
    if (document.body.classList.contains('touch')) {
      const row = e.target.closest('.task');
      if (row && !e.target.closest('button,input,textarea,select,[contenteditable]')) startSwipe(e, row);
    }
  });
}

/* --- Outside-click handler --- */
function wireOutsideClick() {
  document.addEventListener('click', e => {
    if (popOpen && !popOpen.contains(e.target)
      && !e.target.closest('[data-action="list-menu"],[data-action="open-momentum"]')) closePops();
    const sp = $('#settingsPop');
    if (!sp.hidden && !sp.contains(e.target) && !e.target.closest('#btnSettings')) sp.hidden = true;
  });
}

/* --- Composer form --- */
function wireComposer() {
  const composerForm = $('#composerForm');
  composerForm.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#composerInput');
    let title = input.value.trim();
    if (!title) return;
    // 1) view-based defaults, 2) explicit option-panel choices, 3) NL tokens
    let parsed;
    try { parsed = parseQuickAdd(title); } catch (err) { parsed = { title }; }
    title = parsed.title || '';
    if (!title) { toast(lang() === 'fa' ? 'متن کار خالی ماند' : 'Task text was empty'); return; }
    const tgt = composerTarget();
    if (ui.composer.listId) tgt.listId = ui.composer.listId;      // panel beats view
    if (ui.composer.due) tgt.due = ui.composer.due;               // panel beats view
    else if (parsed.due) tgt.due = parsed.due;                    // typed date beats view default
    if (ui.composer.time) tgt.reminder = `${tgt.due || todayISO()}T${ui.composer.time}`;
    else if (parsed.reminder) tgt.reminder = parsed.reminder;
    if (ui.composer.repeat) tgt.repeat = { ...ui.composer.repeat };
    else if (parsed.repeat) tgt.repeat = parsed.repeat;
    if (ui.composer.important || parsed.important) tgt.important = true;
    const tk = addTask({ title, ...tgt });
    input.value = '';
    input.focus();
    resetComposerOpts();
    closeAllPopups();
    updateComposerActions();
    sfx.add();
    persistAndRender([tk.id]);
    ensureTaskVisible(tk.id);
  });

  /* Due date popup */
  const cxDueBtn = $('#cxDueBtn');
  if (cxDueBtn) cxDueBtn.addEventListener('click', e => { e.stopPropagation(); togglePopup('cxDuePopup'); updateDueHints(); });
  /* Reminder popup */
  const cxReminderBtn = $('#cxReminderBtn');
  if (cxReminderBtn) cxReminderBtn.addEventListener('click', e => { e.stopPropagation(); togglePopup('cxReminderPopup'); });
  /* Repeat popup */
  const cxRepeatBtn = $('#cxRepeatBtn');
  if (cxRepeatBtn) cxRepeatBtn.addEventListener('click', e => { e.stopPropagation(); togglePopup('cxRepeatPopup'); buildRepeatSelect(); });
  /* List popup */
  const cxListBtn = $('#cxListBtn');
  if (cxListBtn) cxListBtn.addEventListener('click', e => { e.stopPropagation(); togglePopup('cxListPopup'); buildListSelect(); });

  /* Quick due date options */
  $$('[data-action="cx-quick"]').forEach(btn => btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    if (q === 'today') ui.composer.due = todayISO();
    else if (q === 'tomorrow') ui.composer.due = addDaysISO(todayISO(), 1);
    else if (q === 'nextweek') ui.composer.due = addDaysISO(todayISO(), 7);
    closeAllPopups(); updateComposerActions();
  }));
  /* Quick reminder options */
  $$('[data-action="cx-quick-remind"]').forEach(btn => btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    const today = todayISO();
    if (q === 'later') { ui.composer.due = today; ui.composer.time = '20:00'; }
    else if (q === 'tomorrow') { ui.composer.due = addDaysISO(today, 1); ui.composer.time = '09:00'; }
    else if (q === 'nextweek') { ui.composer.due = addDaysISO(today, 7); ui.composer.time = '09:00'; }
    closeAllPopups(); updateComposerActions();
  }));
  /* Due picker fallback */
  $$('[data-action="cx-due"]').forEach(btn => btn.addEventListener('click', () => {
    closeAllPopups(); openPicker({ field: 'cx-due', valueIso: ui.composer.due });
  }));

  /* Close popups on outside click */
  document.addEventListener('click', e => {
    if (!e.target.closest('.c-popup') && !e.target.closest('.c-action')) closeAllPopups();
  });

  function composerTarget() {
    const lid = viewListId();
    if (lid) return { listId: lid };
    if (ui.view === 'calendar') return { listId: 'tasks', due: ui.calSel || todayISO() };
    switch (ui.view) {
      case 'myday': return { listId: 'tasks', myDay: true };
      case 'important': return { listId: 'tasks', important: true };
      case 'planned': return { listId: 'tasks', due: todayISO() };
      default: return { listId: 'tasks' };
    }
  }

  const searchInput = $('#searchInput');
  const doSearch = debounce(() => { renderView(); }, 120);
  searchInput.addEventListener('input', () => { ui.search = searchInput.value; setSearchBox(searchInput.value); doSearch(); });
  $('#btnClearSearch').addEventListener('click', () => { ui.search = ''; setSearchBox(''); renderView(); searchInput.focus(); });

  $('#btnMenu').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('side-open'));
  $('#btnSideClose').addEventListener('click', () => document.body.classList.remove('side-open'));

  $('#btnSettings').addEventListener('click', e => { e.stopPropagation(); toggleSettingsPop(); });
  $$('.theme-card').forEach(b => b.addEventListener('click', () => setSetting('theme', b.dataset.theme)));
  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === 'auto') setSetting('autoTheme', true);
    else {
      if (S.settings.autoTheme) { S.settings.autoTheme = false; saveSoon(); }
      setSetting('mode', b.dataset.mode);
    }
  }));
  $$('#langSeg button').forEach(b => b.addEventListener('click', () => setSetting('lang', b.dataset.lang)));
  $$('#calSeg button').forEach(b => b.addEventListener('click', () => setSetting('calendar', b.dataset.cal)));

  /* sound toggle */
  $('#btnSound').addEventListener('click', () => {
    setSetting('sound', !S.settings.sound);
    if (S.settings.sound) sfx.complete();     // audible confirmation when enabling
  });
  /* achievements shelf */
  $('#btnTrophy').addEventListener('click', () => { $('#settingsPop').hidden = true; openTrophy(); });
  $('#trophyBackdrop').addEventListener('click', () => closeModal('#trophyRoot'));

  /* accent swatches (built once; states synced by syncSettingsUI) */
  const accentRow = $('#accentRow');
  accentRow.innerHTML = ACCENTS.map(c => c
    ? `<button type="button" class="sw" data-val="${c}" style="background:${c}" data-action="set-accent" aria-label="${c}"></button>`
    : `<button type="button" class="sw def" data-val="" data-action="set-accent" aria-label="${esc(t('accent.default'))}"></button>`).join('');

  /* command palette */
  $('#palBackdrop').addEventListener('click', closePalette);
  const palInput = $('#palInput');
  palInput.addEventListener('input', () => { ui.pal.idx = 0; renderPal(); });
  palInput.addEventListener('keydown', e => {
    const n = ui.pal.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); ui.pal.idx = (ui.pal.idx + 1) % n; renderPal(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); ui.pal.idx = (ui.pal.idx - 1 + n) % n; renderPal(); }
    else if (e.key === 'Enter') { e.preventDefault(); ui.pal.items[ui.pal.idx]?.run(); }
  });

  /* backup: export / import */
  $('#btnExport').addEventListener('click', () => {
    saveNow();
    const blob = new Blob([localStorage.getItem(STORE_KEY) || '{}'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planer-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('#settingsPop').hidden = true;
  });
  /* PWA install prompt (browser shows its own UI when we call prompt()) */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    $('#btnInstall').hidden = false;
  });
  $('#btnInstall').addEventListener('click', async () => {
    $('#settingsPop').hidden = true;
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice;
    if (choice.outcome === 'accepted') toast(t('set.installed'));
    deferredInstall = null;
    $('#btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    $('#btnInstall').hidden = true;
    toast(t('set.installed'));
  });
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!d || d.v !== 1 || !Array.isArray(d.tasks)) throw new Error('bad');
        openConfirm({
          title: t('cf.import.title'),
          body: t('cf.import.body'),
          yesLabel: t('set.import'),
          onYes: () => { localStorage.setItem(STORE_KEY, JSON.stringify(d)); location.reload(); },
        });
      } catch (err) { toast(t('toast.importFail')); }
    };
    rd.readAsText(f);
    e.target.value = '';
  });

  /* bulk bar */
  $('#bulkMoveSel').addEventListener('change', () => {
    const dest = $('#bulkMoveSel').value;
    [...ui.sel].forEach(id => { const tk = byId(id); if (tk) { tk.listId = dest; tk.order = ++S.seq; } });
    clearSel();
    toast(t('toast.moved', { list: esc(listName(dest)) }));
    persistAndRender();
  });

  $('#btnMode').addEventListener('click', () => setSetting('mode', S.settings.mode === 'dark' ? 'light' : 'dark'));
  $('#btnLang').addEventListener('click', () => setSetting('lang', S.settings.lang === 'en' ? 'fa' : 'en'));
  $('#btnShortcuts').addEventListener('click', () => { $('#settingsPop').hidden = true; openModal('#shortcutsRoot'); });

  /* new-list form: template chips, color + icon pickers */
  const nlColors = $('#nlColors');
  nlColors.innerHTML = LIST_COLORS.map(c =>
    `<button type="button" class="sw${c === 'violet' ? ' on' : ''}" data-color="${c}" style="background:var(--lc-${c})" aria-label="${c}"></button>`).join('');
  nlColors.addEventListener('click', e => {
    const sw = e.target.closest('.sw'); if (!sw) return;
    $$('.sw', nlColors).forEach(x => x.classList.remove('on'));
    sw.classList.add('on');
  });
  const nlIcons = $('#nlIcons');
  nlIcons.innerHTML = LIST_ICONS.map(ic =>
    `<button type="button" class="ic-sw${ic ? '' : ' letter on'}" data-icon="${ic}" aria-label="${ic || 'letter'}">${ic ? `<svg><use href="#${ic}"/></svg>` : `<span>${esc(lang() === 'fa' ? 'حرف' : 'Aa')}</span>`}</button>`).join('');
  nlIcons.addEventListener('click', e => {
    const sw = e.target.closest('.ic-sw'); if (!sw) return;
    $$('.ic-sw', nlIcons).forEach(x => x.classList.remove('on'));
    sw.classList.add('on');
  });
  const nlTpl = $('#nlTpl');
  nlTpl.innerHTML = LIST_TEMPLATES.map(tp =>
    `<button type="button" class="tpl-chip" data-key="${tp.key}"><svg><use href="#${tp.icon}"/></svg><span>${esc(t('tpl.' + tp.key))}</span></button>`).join('');
  nlTpl.addEventListener('click', e => {
    const chip = e.target.closest('.tpl-chip'); if (!chip) return;
    const tp = LIST_TEMPLATES.find(x => x.key === chip.dataset.key); if (!tp) return;
    $('#nlName').value = t('tpl.' + tp.key);
    $$('.sw', nlColors).forEach(x => x.classList.toggle('on', x.dataset.color === tp.color));
    $$('.ic-sw', nlIcons).forEach(x => x.classList.toggle('on', (x.dataset.icon || '') === tp.icon));
  });
  $('#btnAddGroup').addEventListener('click', () => {
    const name = prompt(t('group.new'));
    if (name && name.trim()) {
      addGroup(name.trim());
      saveSoon(); renderSidebar();
    }
  });
  $('#btnAddList').addEventListener('click', () => {
    const f = $('#newListForm');
    f.hidden = !f.hidden;
    if (!f.hidden) { $('#nlName').value = ''; $('#nlName').focus(); }
  });
  $('#nlCancel').addEventListener('click', () => { $('#newListForm').hidden = true; });
  $('#newListForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#nlName').value.trim();
    if (!name) return;
    const color = $('.sw.on', nlColors)?.dataset.color;
    const icon = $('.ic-sw.on', nlIcons)?.dataset.icon || '';
    const li = addList(name, color, icon);
    $('#newListForm').hidden = true;
    ui.view = 'list:' + li.id; S.settings.lastView = ui.view; ui._enter = true;
    persistAndRender();
  });

  /* drawer */
  $('#dClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  $('#dTitle').addEventListener('input', debounce(() => {
    const tk = byId(ui.drawerId); if (!tk) return;
    tk.title = $('#dTitle').value.replace(/\n/g, ' ');
    saveSoon(); updateTaskRow(tk.id);
    autoResizeTextarea($('#dTitle'));
  }, 200));
  $('#dTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  $('#dNotes').addEventListener('input', debounce(() => {
    const tk = byId(ui.drawerId); if (!tk) return;
    tk.notes = $('#dNotes').value;
    saveSoon(); updateTaskRow(tk.id);
  }, 250));
  $('#dStar').addEventListener('click', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    tk.important = !tk.important;
    saveSoon(); refreshDrawerValues(); updateTaskRow(tk.id); renderSidebar(); renderView();
  });
  $('#dMyday').addEventListener('click', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    tk.myDay = !tk.myDay;
    saveSoon(); refreshDrawerValues(); updateTaskRow(tk.id); renderSidebar(); renderView();
  });
  $('#dDelete').addEventListener('click', () => {
    const id = ui.drawerId; if (!id) return;
    closeDrawer();
    const row = $(`#view .task[data-id="${id}"]`);
    animateRemove(row, () => { removeTask(id); persistAndRender(); });
  });
  $('#dueRow').addEventListener('click', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    openPicker({ taskId: tk.id, field: 'due', valueIso: tk.due });
  });
  $('#remRow').addEventListener('click', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    openPicker({ taskId: tk.id, field: 'reminder', valueIso: tk.reminder ? tk.reminder.split('T')[0] : null, time: tk.reminder ? tk.reminder.split('T')[1] : '09:00' });
  });
  $('#repSel').addEventListener('change', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    const v = $('#repSel').value;
    tk.repeat = v === 'none' ? null : { type: v, every: v === 'custom' ? ($('#repEvery').valueAsNumber || 3) : tk.repeat?.every || 3 };
    $('#repCustomWrap').hidden = v !== 'custom';
    saveSoon(); updateTaskRow(tk.id);
  });
  $('#repEvery').addEventListener('change', () => {
    const tk = byId(ui.drawerId); if (!tk || tk.repeat?.type !== 'custom') return;
    tk.repeat.every = clampN($('#repEvery').valueAsNumber || 3, 2, 365);
    saveSoon(); updateTaskRow(tk.id);
  });
  $('#moveSel').addEventListener('change', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    const dest = $('#moveSel').value;
    if (dest === tk.listId) return;
    tk.listId = dest; tk.order = ++S.seq;
    saveSoon();
    toast(t('toast.moved', { list: esc(listName(dest)) }));
    renderSidebar(); renderView(); updateTaskRow(tk.id);
  });

  /* priority */
  const PRI_OPTS = ['none', 'low', 'medium', 'high'];
  $('#dPriorityRow').addEventListener('click', () => {
    const tk = byId(ui.drawerId); if (!tk) return;
    const cur = PRI_OPTS.indexOf(tk.priority || 'none');
    setPriority(PRI_OPTS[(cur + 1) % PRI_OPTS.length]);
  });

  /* tags */
  $('#dTagsWrap').addEventListener('click', e => {
    const xBtn = e.target.closest('.d-tag-x');
    if (xBtn) removeTagFromTask(xBtn.dataset.tagid);
  });
  $('#dAddTag').addEventListener('click', () => {
    const name = prompt(t('ph.newTag'));
    if (!name || !name.trim()) return;
    const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4'];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    addTagToTask(name.trim(), color);
  });

  /* attachments */
  $('#dAttachInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) addAttachment(file);
    e.target.value = '';
  });
  $('#dAttachList').addEventListener('click', e => {
    const delBtn = e.target.closest('.d-attach-del');
    if (delBtn) removeAttachment(delBtn.dataset.attachid);
  });

  /* dependencies */
  $('#dDepSelect').addEventListener('change', () => {
    const v = $('#dDepSelect').value;
    if (v) { addDependency(v); $('#dDepSelect').value = ''; }
  });
  $('#dDepsList').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-depid]');
    if (delBtn) removeDependency(delBtn.dataset.depid);
  });
  $('#stepForm').addEventListener('submit', e => {
    e.preventDefault();
    const tk = byId(ui.drawerId); if (!tk) return;
    const inp = $('#stepInput');
    const txt = inp.value.trim();
    if (!txt) return;
    tk.steps.push({ id: uid(), text: txt, done: false });
    inp.value = ''; inp.focus();
    saveSoon(); renderSteps(); updateTaskRow(tk.id);
  });

  /* picker */
  $('#pkBackdrop').addEventListener('click', closePicker);
  $('#pkPrev').addEventListener('click', () => pkShift(-1));
  $('#pkNext').addEventListener('click', () => pkShift(1));
  $('#pkCalG').addEventListener('click', () => { if (ui.pk) { switchPkCal('g'); } });
  $('#pkCalJ').addEventListener('click', () => { if (ui.pk) { switchPkCal('j'); } });
  $$('.pk-foot .link').forEach(b => b.addEventListener('click', () => commitPick({
    clear: null, yesterday: addDaysISO(todayISO(), -1), today: todayISO(), tomorrow: addDaysISO(todayISO(), 1),
  }[b.dataset.q])));
  $('#pkTime').addEventListener('change', () => { if (ui.pk) ui.pk.time = $('#pkTime').value; });

  /* confirm modal */
  $('#cfBackdrop').addEventListener('click', () => closeModal('#confirmRoot'));
  $('#cfNo').addEventListener('click', () => closeModal('#confirmRoot'));
  $('#cfYes').addEventListener('click', () => { closeModal('#confirmRoot'); const cb = ui.confirmCb; ui.confirmCb = null; cb?.(); });

  /* background picker */
  $('#bgBackdrop').addEventListener('click', closeBackgroundPicker);
  $('#bgClose').addEventListener('click', closeBackgroundPicker);
  $('#suggestClose').addEventListener('click', closeSuggestions);

  /* account modal */
  $('#accountBackdrop').addEventListener('click', closeAccountModal);
  $('#accountClose').addEventListener('click', closeAccountModal);
  $('#btnSync').addEventListener('click', openAccountModal);
  $('#bgGrid').addEventListener('click', e => {
    const sw = e.target.closest('.bg-swatch');
    if (sw) applyBackground(sw.dataset.bgValue);
  });
  $('#bgClear').addEventListener('click', () => applyBackground(''));
  $('#bgUploadInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast(t('attach.tooLarge')); return; }
    const reader = new FileReader();
    reader.onload = () => { applyBackground(`url(${reader.result})`); };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  /* shortcuts modal */
  $('#scBackdrop').addEventListener('click', () => closeModal('#shortcutsRoot'));

  /* global keys */
  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (dnd.active) { finishDrag(false); return; }
      if (ui.pk) { closePicker(); return; }
      if ($('#paletteRoot').classList.contains('open')) { closePalette(); return; }
      if ($('#confirmRoot').classList.contains('open')) { closeModal('#confirmRoot'); return; }
      if ($('#shortcutsRoot').classList.contains('open')) { closeModal('#shortcutsRoot'); return; }
      if ($('#trophyRoot').classList.contains('open')) { closeModal('#trophyRoot'); return; }
      if (!$('#settingsPop').hidden) { $('#settingsPop').hidden = true; return; }
      if (popOpen) { closePops(); return; }
      if (ui.sel.size) { clearSel(); renderView(); return; }
      if (ui.drawerId) { closeDrawer(); return; }
      if (document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); return; }
      if (typing) e.target.blur();
      return;
    }
    if (typing) return;
    // Enter activates a focused calendar day cell (role="button")
    if (e.key === 'Enter' && e.target.closest?.('[data-action="cal-pick"]')) {
      e.target.closest('[data-action="cal-pick"]').click();
      return;
    }
    // Ctrl/Cmd+K — command palette
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#paletteRoot').classList.contains('open')) closePalette(); else openPalette();
      return;
    }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#composerInput').focus(); }
    else if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
    else if (e.key === '?') { openModal('#shortcutsRoot'); }
  });

  window.addEventListener('resize', () => {
    if (innerWidth >= 1024) document.body.classList.remove('side-open');
    closePops();
  });
}
function switchPkCal(cal) {
  const pk = ui.pk; if (!pk) return;
  const refIso = pk.sel || (pk.cal === 'g' ? isoFromG(pk.y, pk.m + 1, 1) : isoFromJ(pk.y, pk.m, 1));
  pk.cal = cal;
  if (cal === 'g') { const g = parseISO(refIso); pk.y = g.gy; pk.m = g.gm - 1; }
  else { const j = jPart(refIso); pk.y = j.jy; pk.m = j.jm; }
  syncPkSeg();
  renderPicker();
}
/** Shrink-then-remove animation before actually deleting a row's task. */
function animateRemove(row, done) {
  if (!row) { done(); return; }
  row.style.height = row.offsetHeight + 'px';
  void row.offsetHeight;
  row.classList.add('removing');
  setTimeout(done, 240);
}

/* ===================== 18. Seed Data ===================== */
function seed() {
  const T = todayISO();
  const plus = n => addDaysISO(T, n);
  const mkList = (name, color, icon) => addList(name, color, icon);
  const groceries = mkList(lang() === 'fa' ? 'خواروبار' : 'Groceries', 'emerald', 'i-cart');
  const work = mkList(lang() === 'fa' ? 'محل کار' : 'Work', 'sky', 'i-brief');
  const fa = lang() === 'fa';
  const mk = o => { const tk = normalizeTask({ listId: 'tasks', ...o }); tk.id = uid(); tk.order = ++S.seq; S.tasks.push(tk); return tk; };

  mk({ title: fa ? 'به پلنر خوش آمدید! روی دایره بزنید' : 'Welcome to Planer! Tap the circle', myDay: true, due: T,
       steps: [{ id: uid(), text: fa ? 'انیمیشن تیک را ببینید' : 'Watch the checkmark animation', done: false },
               { id: uid(), text: fa ? 'با درگ‌انددراپ جابه‌جا کنید' : 'Try dragging me', done: false }] });
  mk({ title: fa ? 'برنامه هفته را بریزید' : 'Plan your week', myDay: true, due: T, important: true,
       repeat: { type: 'weekly', every: 1 } });
  mk({ title: fa ? 'پوسته‌ها را از تنظیمات امتحان کنید' : 'Explore the themes in Settings', due: plus(2),
       notes: fa ? 'چهار پوسته، هر کدام با حالت روشن و تیره.' : 'Four themes, each with light & dark mode.' });
  mk({ title: fa ? 'قهوه بخر' : 'Buy coffee beans', listId: groceries.id, completed: true, completedAt: plus(-1) });
  S.stats.completionsByDay[plus(-1)] = 1;   // seed counts toward streaks/achievements
  mk({ title: fa ? 'شیر و تخم‌مرغ' : 'Milk and eggs', listId: groceries.id, due: T });
  mk({ title: fa ? 'ارسال نسخه ۱.۰' : 'Ship version 1.0', listId: work.id, due: plus(3), important: true,
       steps: [{ id: uid(), text: fa ? 'بازبینی نهایی' : 'Final review', done: false },
               { id: uid(), text: fa ? 'تگ بزن' : 'Tag the release', done: true }] });
  mk({ title: fa ? 'پاسخ به بازخوردها' : 'Reply to reviews', listId: work.id, due: plus(1),
       reminder: `${plus(1)}T09:00`, repeat: { type: 'daily', every: 1 } });
}

/* ===================== 18b. AI Chat ===================== */
const GEMINI_DEFAULT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash';
let chatHistory = [];

function getApiKey() { return localStorage.getItem('planer.gemini_key') || ''; }
function setApiKey(k) { localStorage.setItem('planer.gemini_key', k); }
function getBaseUrl() { return localStorage.getItem('planer.gemini_base') || ''; }
function setBaseUrl(u) { localStorage.setItem('planer.gemini_base', u); }
function getModel() { return localStorage.getItem('planer.gemini_model') || ''; }
function setModel(m) { localStorage.setItem('planer.gemini_model', m); }
function getWebSearch() { return localStorage.getItem('planer.web_search') !== '0'; }
function setWebSearch(v) { localStorage.setItem('planer.web_search', v ? '1' : '0'); }
function getTavilyKey() { return localStorage.getItem('planer.tavily_key') || ''; }
function setTavilyKey(k) { localStorage.setItem('planer.tavily_key', k); }

function geminiEndpoint(method) {
  const base = getBaseUrl();
  const model = getModel() || 'gemini-2.0-flash';
  if (base) {
    const url = base.replace(/\/+$/, '');
    if (url.endsWith('/v1')) return url + '/chat/completions';
    return url + '/' + method + (method === 'streamGenerateContent' ? '?alt=sse' : '');
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}` + (method === 'streamGenerateContent' ? '?alt=sse' : '');
}

function isOpenAIFormat() {
  const base = getBaseUrl();
  return base && base.replace(/\/+$/, '').endsWith('/v1');
}

function buildRequestBody(searchCtx) {
  const model = getModel() || 'gemini-2.0-flash';
  const listInfo = S.lists.length ? '\n\nCurrent lists: ' + S.lists.map(l => '"' + l.name + '" (id: ' + l.id + ')').join(', ') + '. Use listId "tasks" for the default Tasks list.' : '';
  const sys = 'You are a helpful assistant embedded in a to-do app called Planer. You can help with tasks, productivity, answer general knowledge questions, and more. Be concise and friendly. Respond in the same language the user writes in. When web search results are provided in the user message, base your answer on them — they are real-time facts fetched from the internet. Do NOT say you lack internet access when search results are shown.\n\nWhen the user asks you to create, edit, delete, complete, or star tasks, or add/delete lists, you MUST include action blocks. After your natural language response, append action blocks in this exact format:\n<planer-action>{"type":"create_task","title":"Buy groceries","listId":"tasks","due":"2025-01-15","important":false,"notes":"Milk, eggs, bread","steps":["Check fridge","Make list"]}</planer-action>\n\nAvailable action types:\n- create_task: {type, title, listId?(default "tasks"), due?(yyyy-mm-dd), important?(bool), myDay?(bool), notes?, steps?[], reminder?(yyyy-mm-ddThh:mm), repeat?:{type:"daily"|"weekly"|"monthly"|"yearly",every?:number}}\n- edit_task: {type, taskId, title?, due?, important?, myDay?, listId?, notes?}\n- delete_task: {type, taskId}\n- complete_task: {type, taskId}\n- star_task: {type, taskId, important?(bool)}\n- add_list: {type, name, color?("rose"|"amber"|"grass"|"emerald"|"teal"|"sky"|"indigo"|"violet"|"pink"|"slate"), icon?(""|"i-brief"|"i-home"|"i-book"|"i-cart"|"i-heart"|"i-fit"|"i-plane"|"i-music")}\n- delete_list: {type, listId}\n\nFor listId: use "tasks" for the default Tasks list, or the actual list ID.\nAlways explain what you\'re going to do in your text response BEFORE the action blocks. The user will see a confirmation dialog before any changes are applied.' + listInfo;
  if (isOpenAIFormat()) {
    const msgs = [{ role: 'system', content: sys }];
    for (const m of chatHistory.slice(-20)) {
      msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.parts[0].text });
    }
    if (searchCtx && msgs.length >= 2) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'user') last.content = searchCtx + '\n\n' + last.content;
    }
    return { model, messages: msgs, stream: true, max_tokens: 2048, temperature: 0.7 };
  }
  const contents = chatHistory.slice(-20).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: m.parts,
  }));
  if (searchCtx && contents.length >= 1) {
    const last = contents[contents.length - 1];
    if (last.role === 'user') {
      last.parts = [{ text: searchCtx + '\n\n' + last.parts[0].text }];
    }
  }
  return {
    contents,
    systemInstruction: { parts: [{ text: sys }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  };
}

/* ---------- web search (Tavily API) --------- */
function needsSearch(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 8) return false;
  const noSearch = /^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|help|bye|good\s*(morning|evening|afternoon|night)|how are you|what'?s up|sup|yo|np|kk|lol|haha|great|nice|cool|awesome|perfect|good|bad|fine|well|please|sorry|excuse|wait|stop|cancel|never mind|nevermind|edit|delete|remove|add|create|show|open|close|toggle|theme|setting|dark|light|export|import|backup|restore|clear|undo|redo|help me|what can you|who are you|what are you|your name|planer|search (the |me |internet|online|up)|can you help|could you help|would you)/i;
  if (noSearch.test(q)) return false;
  if (/^(what|who|when|where|which|how|why|is|are|was|were|do|does|did|can|could|would|should|will|tell me|search|look up|find|google|define|explain)\b/i.test(q)) return true;
  if (q.includes('?')) return true;
  if (/\b(release|date|year|price|cost|population|capital|president|founder|CEO|headquarters|located|height|weight|size|distance|speed|temperature|score|winner|champion|latest|newest|recent|update|news|history|invented|created|built|founded|established|originated)\b/i.test(q)) return true;
  if (q.split(/\s+/).length > 5) return true;
  return false;
}

async function tavilySearch(query) {
  const key = getTavilyKey();
  if (!key) return [];
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic', api_key: key })
    });
    if (!r.ok) { console.warn('[Planer] Tavily HTTP', r.status); return []; }
    const j = await r.json();
    return (j.results || []).map(r => ({ title: r.title || '', snippet: (r.content || '').slice(0, 300), source: r.url || '' }));
  } catch (e) { console.warn('[Planer] Tavily search error:', e); return []; }
}

async function buildSearchContext(query) {
  if (!getWebSearch() || !needsSearch(query)) return '';
  if (!getTavilyKey()) return '';
  const results = await tavilySearch(query);
  if (!results.length) return '';
  const lines = results.map((r, i) => `[${i + 1}] ${r.title} (${r.source})\n${r.snippet}`);
  const block = lines.join('\n\n');
  return '---BEGIN WEB SEARCH RESULTS---\n' + block + '\n---END WEB SEARCH RESULTS---';
}

function renderMd(text) {
  let s = esc(String(text));
  s = s.replace(/```([\s\S]*?)```/g, '<code>$1</code>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return s;
}

function addChatMsg(role, text, extra) {
  const d = $('#chatMsgs');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role + (extra ? ' ' + extra : '');
  div.innerHTML = `<div class="chat-bubble">${role === 'ai' ? renderMd(text) : esc(text)}</div>`;
  d.appendChild(div);
  d.scrollTop = d.scrollHeight;
  return div;
}

function showTyping() {
  const d = $('#chatMsgs');
  const div = document.createElement('div');
  div.className = 'chat-msg ai';
  div.id = 'chatTyping';
  div.innerHTML = '<div class="chat-typing"><span></span><span></span><span></span></div>';
  d.appendChild(div);
  d.scrollTop = d.scrollHeight;
}
function hideTyping() { const el = $('#chatTyping'); if (el) el.remove(); }

async function sendToGemini(text) {
  const key = getApiKey();
  if (!key) { showChatSetup(); return; }

  addChatMsg('user', text);
  chatHistory.push({ role: 'user', parts: [{ text }] });
  showTyping();
  $('#chatSend').disabled = true;

  try {
    /* web search (with 6s timeout so a slow API can't freeze the chat) */
    let searchCtx = '';
    try {
      searchCtx = await Promise.race([
        buildSearchContext(text),
        new Promise((_, rej) => setTimeout(() => rej(new Error('search timeout')), 6000)),
      ]);
    } catch (e) { console.warn('[Planer] search skipped:', e.message || e); }
    if (searchCtx) {
      addChatMsg('info', '🔍 Web search: found results for "' + text.slice(0, 50) + '"', 'search-info');
    }

    const customBase = !!getBaseUrl();
    const useOpenAI = isOpenAIFormat();
    const url = useOpenAI
      ? (customBase ? getBaseUrl().replace(/\/+$/, '') + '/chat/completions' : '')
      : geminiEndpoint('streamGenerateContent') + (customBase ? '' : '&key=' + encodeURIComponent(key));
    const headers = { 'Content-Type': 'application/json' };
    if (customBase) headers['Authorization'] = 'Bearer ' + key;
    const body = JSON.stringify(buildRequestBody(searchCtx));
    console.log('[Planer] sending to:', url, '| body size:', body.length, '| search:', searchCtx ? 'yes' : 'no');

    const res = await fetch(url, { method: 'POST', headers, body });

    hideTyping();

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        errMsg = errBody.error?.message || errBody.message || errMsg;
      } catch (e) {
        try { errMsg = (await res.text()).slice(0, 200) || errMsg; } catch (e2) {}
      }
      throw new Error(errMsg);
    }

    const aiDiv = addChatMsg('ai', '');
    const bubble = aiDiv.querySelector('.chat-bubble');
    let full = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let lastChunkTime = Date.now();
    const STREAM_TIMEOUT = 30000;

    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('stream timeout')), STREAM_TIMEOUT)),
      ]);
      if (done) break;
      lastChunkTime = Date.now();
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const ln of lines) {
        if (!ln.startsWith('data: ')) continue;
        const data = ln.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          let part = '';
          if (useOpenAI) {
            part = obj.choices?.[0]?.delta?.content || '';
          } else {
            part = obj.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
          if (part) { full += part; bubble.innerHTML = renderMd(full); }
        } catch (e) {}
      }
    }
    /* strip action blocks from displayed text & parse them */
    const displayText = stripActionBlocks(full);
    const actions = parsePlanerActions(full);
    if (displayText !== full) { bubble.innerHTML = renderMd(displayText); }
    chatHistory.push({ role: 'model', parts: [{ text: displayText }] });
    const d = $('#chatMsgs'); d.scrollTop = d.scrollHeight;
    if (actions.length) { setTimeout(() => showActionModal(actions), 300); }
  } catch (err) {
    hideTyping();
    addChatMsg('ai', t('chat.error') + (err.message ? ' (' + err.message + ')' : ''), 'error');
    if (err.message?.includes('Invalid') || err.message?.includes('400') || err.message?.includes('403')) {
      showChatSetup();
    }
  } finally {
    $('#chatSend').disabled = false;
    $('#chatInput').value = '';
    $('#chatInput').focus();
  }
}

function showChatSetup() {
  $('#chatOverlay').hidden = false;
  $('#chatKeyInput').value = getApiKey();
  $('#chatBaseUrl').value = getBaseUrl();
  $('#chatModel').value = getModel();
  $('#chatKeyInput').focus();
}
function hideChatSetup() { $('#chatOverlay').hidden = true; }

function initChat() {
  const fab = $('#chatFab'), panel = $('#chatPanel'), close = $('#chatClose');
  const form = $('#chatForm'), input = $('#chatInput'), msgs = $('#chatMsgs');
  const overlay = $('#chatOverlay'), keyIn = $('#chatKeyInput');
  const keySave = $('#chatKeySave'), keyCancel = $('#chatKeyCancel');

  fab.addEventListener('click', () => {
    panel.hidden = false; fab.classList.add('open');
    if (!getApiKey()) showChatSetup();
    else input.focus();
  });
  close.addEventListener('click', () => { panel.hidden = true; fab.classList.remove('open'); });

  /* web search toggle */
  const wsBtn = $('#chatWsToggle');
  if (wsBtn) {
    const syncWs = () => wsBtn.classList.toggle('on', getWebSearch());
    syncWs();
    wsBtn.addEventListener('click', () => { setWebSearch(!getWebSearch()); syncWs(); });
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    sendToGemini(v);
  });

  /* API key setup overlay */
  keySave.addEventListener('click', () => {
    const k = keyIn.value.trim();
    if (k) { setApiKey(k); hideChatSetup(); input.focus(); toast('API key saved'); }
    const u = $('#chatBaseUrl').value.trim(); setBaseUrl(u);
    const m = $('#chatModel').value.trim(); setModel(m);
    const tv = $('#chatTavilyKey')?.value.trim(); if (tv) setTavilyKey(tv);
  });
  keyCancel.addEventListener('click', hideChatSetup);
  keyIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); keySave.click(); } });

  /* settings API key row */
  const sKeyIn = $('#settingsApiKey'), sKeySave = $('#btnSaveKey');
  const sBaseUrl = $('#settingsBaseUrl'), sModel = $('#settingsModel');
  const sTavily = $('#settingsTavilyKey');
  if (sKeyIn) {
    sKeyIn.value = getApiKey();
    if (sBaseUrl) sBaseUrl.value = getBaseUrl();
    if (sModel) sModel.value = getModel();
    if (sTavily) sTavily.value = getTavilyKey();
    sKeySave.addEventListener('click', () => {
      const k = sKeyIn.value.trim();
      if (k) { setApiKey(k); toast('AI settings saved'); } else { localStorage.removeItem('planer.gemini_key'); toast('API key removed'); }
      if (sBaseUrl) setBaseUrl(sBaseUrl.value.trim());
      if (sModel) setModel(sModel.value.trim());
      if (sTavily) setTavilyKey(sTavily.value.trim());
      $('#settingsPop').hidden = true;
    });
  }

  /* click outside overlay closes it */
  overlay.addEventListener('click', e => { if (e.target === overlay) hideChatSetup(); });
}

/* ===================== 18c. AI Action System ===================== */
const ACTION_RE = /<planer-action>([\s\S]*?)<\/planer-action>/g;

function parsePlanerActions(text) {
  const actions = [];
  let m;
  ACTION_RE.lastIndex = 0;
  while ((m = ACTION_RE.exec(text)) !== null) {
    try { actions.push(JSON.parse(m[1].trim())); } catch (e) { console.warn('[Planer] bad action JSON:', m[1]); }
  }
  return actions;
}

function stripActionBlocks(text) {
  return text.replace(/<planer-action>[\s\S]*?<\/planer-action>/g, '').trim();
}

function describeAction(a) {
  switch (a.type) {
    case 'create_task': return `"${a.title || 'Untitled'}"` + (a.due ? ` due ${a.due}` : '') + (a.listId && a.listId !== 'tasks' ? ` in list "${(getList(a.listId)||{}).name||a.listId}"` : '');
    case 'edit_task': {
      const tk = byId(a.taskId);
      const name = tk ? `"${tk.title}"` : a.taskId;
      const changes = [];
      if (a.title) changes.push('title → ' + a.title);
      if (a.due !== undefined) changes.push('due → ' + (a.due || 'none'));
      if (a.important !== undefined) changes.push(a.important ? '★ starred' : '☆ unstarred');
      if (a.notes !== undefined) changes.push('notes updated');
      return `${name}: ${changes.join(', ') || 'no changes'}`;
    }
    case 'delete_task': {
      const tk = byId(a.taskId);
      return tk ? `"${tk.title}"` : a.taskId;
    }
    case 'complete_task': {
      const tk = byId(a.taskId);
      return tk ? `"${tk.title}"` : a.taskId;
    }
    case 'star_task': {
      const tk = byId(a.taskId);
      return tk ? `"${tk.title}" → ${a.important ? 'starred' : 'unstarred'}` : a.taskId;
    }
    case 'add_list': return `"${a.name || 'Untitled list'}"`;
    case 'delete_list': {
      const li = getList(a.listId);
      return li ? `"${li.name}"` : a.listId;
    }
    default: return JSON.stringify(a);
  }
}

function actionBadgeClass(a) {
  if (a.type === 'create_task') return 'create';
  if (a.type === 'edit_task') return 'edit';
  if (a.type === 'delete_task') return 'delete';
  if (a.type === 'complete_task') return 'complete';
  if (a.type === 'star_task') return 'star';
  if (a.type === 'add_list' || a.type === 'delete_list') return 'list';
  return 'edit';
}

function actionLabelKey(a) {
  switch (a.type) {
    case 'create_task': return 'chat.actionCreate';
    case 'edit_task': return 'chat.actionEditTask';
    case 'delete_task': return 'chat.actionDelete';
    case 'complete_task': return 'chat.actionComplete';
    case 'star_task': return 'chat.actionStar';
    case 'add_list': return 'chat.actionAddList';
    case 'delete_list': return 'chat.actionDeleteList';
    default: return 'chat.actionEdit';
  }
}

function actionFieldsForType(a) {
  switch (a.type) {
    case 'create_task': {
      const lists = [{ id: 'tasks', name: t('nav.tasks') }, ...S.lists];
      const options = lists.map(l => `<option value="${l.id}" ${l.id === (a.listId || 'tasks') ? 'selected' : ''}>${l.name}</option>`).join('');
      return `
        <div class="action-field"><label>${t('ph.newList') || 'Title'}</label><input data-key="title" value="${esc(a.title || '')}"></div>
        <div class="action-field-row">
          <div class="action-field"><label>${t('cx.when') || 'Due'}</label><input type="date" data-key="due" value="${a.due || ''}"></div>
          <div class="action-field"><label>${t('cx.place') || 'List'}</label><select data-key="listId">${options}</select></div>
        </div>
        <div class="action-field"><label>${t('cx.alert') || 'Notes'}</label><textarea data-key="notes">${esc(a.notes || '')}</textarea></div>`;
    }
    case 'edit_task': {
      const tk = byId(a.taskId);
      const lists = [{ id: 'tasks', name: t('nav.tasks') }, ...S.lists];
      const listOpts = lists.map(l => `<option value="${l.id}" ${l.id === (a.listId || (tk||{}).listId || 'tasks') ? 'selected' : ''}>${l.name}</option>`).join('');
      return `
        <div class="action-field"><label>Title</label><input data-key="title" value="${esc(a.title || (tk||{}).title || '')}"></div>
        <div class="action-field-row">
          <div class="action-field"><label>Due</label><input type="date" data-key="due" value="${a.due !== undefined ? a.due : ((tk||{}).due||'')}"></div>
          <div class="action-field"><label>List</label><select data-key="listId">${listOpts}</select></div>
        </div>
        <div class="action-field"><label>Notes</label><textarea data-key="notes">${esc(a.notes !== undefined ? a.notes : ((tk||{}).notes||''))}</textarea></div>`;
    }
    case 'add_list':
      return `<div class="action-field"><label>${t('ph.newList') || 'Name'}</label><input data-key="name" value="${esc(a.name || '')}"></div>`;
    default: return '';
  }
}

function renderActionCards(actions) {
  const box = $('#actionCards');
  box.innerHTML = '';
  if (!actions.length) { box.innerHTML = `<div class="action-empty">${t('chat.action.none')}</div>`; return; }
  actions.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.dataset.idx = i;
    card.innerHTML = `
      <div class="action-card-head">
        <span class="action-badge ${actionBadgeClass(a)}">${t(actionLabelKey(a))}</span>
        <span class="action-card-title">${esc(describeAction(a))}</span>
      </div>
      ${actionFieldsForType(a) ? `<div class="action-card-body">${actionFieldsForType(a)}</div>` : ''}
      <div class="action-card-actions">
        <button class="btn ghost act-remove" data-i18n="chat.actionRemove">${t('chat.actionRemove')}</button>
        <button class="btn primary act-edit" data-i18n="chat.actionEdit">${t('chat.actionEdit')}</button>
      </div>`;
    box.appendChild(card);
  });
}

function collectActionEdits(actions) {
  const cards = $$('.action-card');
  cards.forEach((card, i) => {
    if (!actions[i]) return;
    const a = { ...actions[i] };
    card.querySelectorAll('[data-key]').forEach(inp => {
      const key = inp.dataset.key;
      const val = inp.tagName === 'SELECT' ? inp.value : inp.value.trim();
      if (key === 'title') a.title = val;
      else if (key === 'due') a.due = val || null;
      else if (key === 'listId') a.listId = val;
      else if (key === 'notes') a.notes = val;
      else if (key === 'name') a.name = val;
    });
    actions[i] = a;
  });
  return actions;
}

function applyActions(actions) {
  const applied = [];
  for (const a of actions) {
    try {
      switch (a.type) {
        case 'create_task': {
          const tk = addTask({ title: a.title || 'Untitled', listId: a.listId || 'tasks', important: !!a.important, myDay: !!a.myDay, due: a.due || null });
          if (a.notes) tk.notes = a.notes;
          if (a.steps && Array.isArray(a.steps)) a.steps.forEach(s => tk.steps.push({ id: uid(), text: s, done: false }));
          if (a.reminder) tk.reminder = a.reminder;
          if (a.repeat) tk.repeat = a.repeat;
          applied.push(tk);
          break;
        }
        case 'edit_task': {
          const tk = byId(a.taskId);
          if (!tk) break;
          if (a.title !== undefined) tk.title = a.title;
          if (a.due !== undefined) tk.due = a.due;
          if (a.important !== undefined) tk.important = a.important;
          if (a.myDay !== undefined) tk.myDay = a.myDay;
          if (a.listId !== undefined) tk.listId = a.listId;
          if (a.notes !== undefined) tk.notes = a.notes;
          applied.push(tk);
          break;
        }
        case 'delete_task': removeTask(a.taskId); break;
        case 'complete_task': {
          const tk = byId(a.taskId);
          if (tk && !tk.completed) { tk.completed = true; tk.completedAt = todayISO(); applied.push(tk); }
          break;
        }
        case 'star_task': {
          const tk = byId(a.taskId);
          if (tk) { tk.important = !!a.important; applied.push(tk); }
          break;
        }
        case 'add_list': { const li = addList(a.name || 'Untitled', a.color, a.icon); applied.push(li); break; }
        case 'delete_list': deleteList(a.listId); break;
      }
    } catch (e) { console.warn('[Planer] action error:', a.type, e); }
  }
  if (applied.length) {
    const ids = applied.filter(x => x.id).map(x => x.id);
    persistAndRender(ids);
  }
}

let _pendingActions = [];

function showActionModal(actions) {
  _pendingActions = actions;
  const overlay = $('#actionOverlay');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('show'));
  renderActionCards(actions);

  /* wire per-card buttons */
  $('#actionCards').onclick = e => {
    const card = e.target.closest('.action-card');
    if (!card) return;
    const idx = +card.dataset.idx;
    if (e.target.closest('.act-remove')) {
      _pendingActions[idx] = null;
      card.style.opacity = '0';
      card.style.transform = 'translateX(30px)';
      setTimeout(() => card.remove(), 200);
      return;
    }
    if (e.target.closest('.act-edit')) {
      const fields = card.querySelector('.action-card-body');
      if (fields) { fields.style.display = fields.style.display === 'none' ? '' : 'none'; }
    }
  };

  $('#actionApproveAll').onclick = () => {
    const edits = collectActionEdits(_pendingActions).filter(Boolean);
    hideActionModal();
    if (edits.length) applyActions(edits);
  };

  $('#actionRejectAll').onclick = () => hideActionModal();

  overlay.addEventListener('click', e => { if (e.target === overlay) hideActionModal(); }, { once: true });
}

function hideActionModal() {
  const overlay = $('#actionOverlay');
  overlay.classList.remove('show');
  setTimeout(() => { overlay.hidden = true; }, 250);
}

/* ===================== 20. Firebase Sync ===================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDqYW88G8IzGc4iZr9_8G5A6m3YY3s9ZX0",
  authDomain: "planer-amin.firebaseapp.com",
  projectId: "planer-amin",
  storageBucket: "planer-amin.firebasestorage.app",
  messagingSenderId: "538223180855",
  appId: "1:538223180855:web:c15ae58129d8f4d9acd3b2"
};

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let currentUser = null;
let syncUnsubscribe = null;
let syncDebounce = null;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') { console.log('[Planer] Firebase SDK not loaded'); return; }
    firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.firestore();
    // Enable offline persistence
    firebaseDb.enablePersistence({ synchronizeTabs: true }).catch(err => {
      console.log('[Planer] Persistence error:', err.code);
    });
    // Listen for auth state changes
    firebaseAuth.onAuthStateChanged(user => {
      currentUser = user;
      updateSyncUI();
      if (user) {
        console.log('[Planer] Signed in:', user.displayName || user.email);
        startSync();
      } else {
        console.log('[Planer] Signed out');
        stopSync();
      }
    });
    console.log('[Planer] Firebase initialized');
  } catch (e) { console.error('[Planer] Firebase init error:', e); }
}

async function signInWithGoogle() {
  if (!firebaseAuth) { toast(t('auth.error')); return; }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebaseAuth.signInWithPopup(provider);
    toast(t('auth.welcome', { name: currentUser?.displayName || '' }));
  } catch (e) {
    console.error('[Planer] Sign-in error:', e);
    if (e.code !== 'auth/popup-closed-by-user') toast(t('auth.error'));
  }
}

async function signOutUser() {
  if (!firebaseAuth) return;
  try {
    await firebaseAuth.signOut();
    toast(t('auth.signedOut'));
  } catch (e) { console.error('[Planer] Sign-out error:', e); }
}

function updateSyncUI() {
  const btn = $('#btnSync');
  const avatar = $('#syncAvatar');
  if (!btn) return;
  if (currentUser) {
    btn.classList.add('synced');
    btn.title = currentUser.displayName || currentUser.email;
    if (currentUser.photoURL && avatar) {
      avatar.src = currentUser.photoURL;
      avatar.hidden = false;
      const globeIcon = btn.querySelector('.ic-sync-off');
      if (globeIcon) globeIcon.style.display = 'none';
    }
  } else {
    btn.classList.remove('synced');
    btn.title = t('auth.signIn');
    if (avatar) { avatar.hidden = true; avatar.src = ''; }
    const globeIcon = btn.querySelector('.ic-sync-off');
    if (globeIcon) globeIcon.style.display = '';
  }
}

function openAccountModal() {
  const root = $('#accountRoot');
  const content = $('#accountContent');
  if (currentUser) {
    content.innerHTML = `
      <div class="account-body">
        <div class="account-profile">
          <img class="account-avatar" src="${currentUser.photoURL || ''}" alt="${esc(currentUser.displayName || '')}">
          <div class="account-info">
            <div class="account-name">${esc(currentUser.displayName || 'User')}</div>
            <div class="account-email">${esc(currentUser.email || '')}</div>
          </div>
        </div>
        <div class="account-status">
          <span class="dot online"></span>
          <span>${S.tasks.length} ${t('lbl.tasks')} • ${S.lists.length} ${t('sec.lists')}</span>
        </div>
        <div class="account-actions">
          <button class="account-btn primary" id="accountSyncNow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 2v6h-6M3 12a9 9 0 0115.63-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.63 6.36L3 16"/></svg>
            <span data-i18n="auth.syncNow">${t('auth.syncNow')}</span>
          </button>
          <button class="account-btn danger" id="accountSignOut">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            <span data-i18n="auth.signOut">${t('auth.signOut')}</span>
          </button>
        </div>
      </div>`;
    $('#accountSyncNow').addEventListener('click', async () => {
      const btn = $('#accountSyncNow');
      btn.classList.add('syncing');
      btn.innerHTML = `<span class="sync-spinner"></span> ${t('auth.syncing')}`;
      await uploadToCloud();
      btn.classList.remove('syncing');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6L9 17l-5-5"/></svg> ${t('auth.synced')}`;
      setTimeout(() => {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 2v6h-6M3 12a9 9 0 0115.63-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.63 6.36L3 16"/></svg> ${t('auth.syncNow')}`;
      }, 2000);
    });
    $('#accountSignOut').addEventListener('click', async () => {
      await signOutUser();
      closeAccountModal();
    });
  } else {
    content.innerHTML = `
      <div class="account-guest">
        <div class="account-guest-icon">☁️</div>
        <div class="account-guest-text" data-i18n="auth.guestMsg">${t('auth.guestMsg')}</div>
        <div class="account-actions">
          <button class="account-btn primary" id="accountSignIn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
            <span data-i18n="auth.signIn">${t('auth.signIn')}</span>
          </button>
        </div>
      </div>`;
    $('#accountSignIn').addEventListener('click', async () => {
      closeAccountModal();
      await signInWithGoogle();
    });
  }
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
}

function closeAccountModal() {
  const root = $('#accountRoot');
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
}

function startSync() {
  if (!currentUser || !firebaseDb) return;
  const docRef = firebaseDb.collection('users').doc(currentUser.uid).collection('data').doc('state');
  // Listen for real-time updates
  syncUnsubscribe = docRef.onSnapshot(doc => {
    if (!doc.exists) {
      // First time: upload local state
      uploadToCloud();
      return;
    }
    const cloudData = doc.data();
    const cloudTime = cloudData.updatedAt?.toMillis() || 0;
    const localTime = S._lastSync || 0;
    if (cloudTime > localTime) {
      // Cloud is newer: merge
      mergeFromCloud(cloudData);
    }
  }, err => {
    console.error('[Planer] Sync error:', err);
    toast(t('auth.syncError'));
  });
  // Upload local changes periodically
  setupAutoUpload();
}

function stopSync() {
  if (syncUnsubscribe) { syncUnsubscribe(); syncUnsubscribe = null; }
  if (syncDebounce) { clearTimeout(syncDebounce); syncDebounce = null; }
}

function setupAutoUpload() {
  const originalSave = saveSoon;
  window._planerAutoSync = true;
}

function uploadToCloud() {
  if (!currentUser || !firebaseDb) return;
  const btn = $('#btnSync');
  if (btn) btn.classList.add('syncing');
  const docRef = firebaseDb.collection('users').doc(currentUser.uid).collection('data').doc('state');
  const data = {
    tasks: S.tasks,
    lists: S.lists,
    groups: S.groups || [],
    settings: S.settings,
    stats: S.stats,
    seq: S.seq,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  docRef.set(data).then(() => {
    S._lastSync = Date.now();
    if (btn) btn.classList.remove('syncing');
    console.log('[Planer] Uploaded to cloud');
  }).catch(err => {
    console.error('[Planer] Upload error:', err);
    if (btn) btn.classList.remove('syncing');
  });
}

function mergeFromCloud(cloudData) {
  console.log('[Planer] Merging cloud data');
  // Merge tasks: cloud wins for conflicts
  if (Array.isArray(cloudData.tasks)) {
    const localMap = new Map(S.tasks.map(t => [t.id, t]));
    const cloudIds = new Set(cloudData.tasks.map(t => t.id));
    const newTasks = [];
    // Update existing or add new
    for (const ct of cloudData.tasks) {
      const lt = localMap.get(ct.id);
      if (!lt) { newTasks.push(normalizeTask(ct)); }
      else { Object.assign(lt, normalizeTask(ct)); }
    }
    // Remove tasks that exist locally but not in cloud (deleted from another device)
    S.tasks = S.tasks.filter(t => cloudIds.has(t.id));
    // Add new tasks from cloud
    S.tasks.push(...newTasks);
  }
  if (Array.isArray(cloudData.lists)) S.lists = cloudData.lists;
  if (Array.isArray(cloudData.groups)) S.groups = cloudData.groups;
  if (cloudData.settings) Object.assign(S.settings, cloudData.settings);
  if (cloudData.stats) Object.assign(S.stats, cloudData.stats);
  if (Number.isFinite(cloudData.seq)) S.seq = cloudData.seq;
  S._lastSync = Date.now();
  saveNow();
  applySettingsToDOM();
  renderAll();
}

function debouncedCloudSync() {
  if (!currentUser || !window._planerAutoSync) return;
  if (syncDebounce) clearTimeout(syncDebounce);
  syncDebounce = setTimeout(uploadToCloud, 2000);
}

// Hook into save to auto-sync
const _origSaveSoon = saveSoon;
window._planerAutoSync = false;

/* ===================== 19. Initialization ===================== */
function init() {
  console.log('[Planer] Starting initialization...');
  S = loadState();
  const fresh = !S;
  if (fresh) {
    console.log('[Planer] Fresh start - creating default state');
    S = defaultState();
    seed();
    saveNow();
  } else {
    console.log('[Planer] Restored state:', { lang: S.settings.lang, theme: S.settings.theme, mode: S.settings.mode, tasks: S.tasks.length, lists: S.lists.length });
  }
  if (S.settings.lastView) ui.view = S.settings.lastView;
  if (viewListId() && !getList(viewListId())) ui.view = 'tasks';

  wireEvents();
  applySettingsToDOM();
  buildRepSel(); buildMoveSel();   // safe even with no drawer open
  buildCxSelects();                // composer repeat/list options
  ui._enter = true;
  renderAll();

  // time-aware theme: re-evaluate Auto light/dark every minute
  setInterval(() => {
    if (S.settings.autoTheme && document.documentElement.dataset.mode !== effectiveMode()) applySettingsToDOM();
  }, 60000);
  // touch device marker enables swipe gestures
  try { if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch'); } catch (e) {}

  setInterval(tickReminders, 20000);
  setTimeout(tickReminders, 1500);
  bindVirtualEvents();
  initChat();
  initFirebase();

  // PWA: register the offline shell — https(s) only; file:// keeps working as before
  if ('serviceWorker' in navigator && /^https:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}
init();
