'use client';

import { useCallback, useEffect, useState } from 'react';

/*
  English / اردو for the driver pages (personal link /d/<user>, Driver trip form /entry, papers box).
  Urdu is in Urdu script (not Roman Urdu). Numbers, amounts and dates always stay in English digits.
  Choice saved on the phone (localStorage "tudo-lang"); all open parts switch together (window event "tudo-lang").
  Office-only parts stay in English.
*/
const KEY = 'tudo-lang';

export const UR = {
  'Driver trip form': 'ڈرائیور ٹرپ فارم',
  'New trip': 'نیا ٹرپ',
  'trips': 'ٹرپ',
  'Open trips': 'جاری ٹرپ',
  'Trips completed': 'مکمل ٹرپ',
  'Completed this month': 'اس مہینے مکمل',
  'No open trips. Press ＋ New trip.': 'کوئی جاری ٹرپ نہیں۔ ＋ نیا ٹرپ دبائیں۔',
  'paper': 'کاغذ',
  'papers': 'کاغذات',
  'Open': 'جاری',
  'Open trip': 'جاری ٹرپ',
  'New trip tag': 'نیا ٹرپ',
  'Completed': 'مکمل',
  '← Trips': 'ٹرپ لسٹ',
  'Trip': 'ٹرپ',
  'Costs': 'اخراجات',
  'Finish': 'مکمل کریں',
  'Trip details': 'ٹرپ کی تفصیل',
  'Trip costs': 'ٹرپ کے اخراجات',
  'Finish the trip': 'ٹرپ مکمل کریں',
  'Type the amount. Tap ⋯ More to add the bill photo.': 'رقم لکھیں۔ بل کی تصویر لگانے کے لیے ⋯ مزید دبائیں۔',
  'Costs total': 'کل اخراجات',
  'Route': 'راستہ',
  'Office part: the office fills it.': 'دفتر والا حصہ: یہ دفتر بھرے گا۔',
  '‹ Back': 'واپس',
  'Next ›': 'آگے',
  '💾 Save': '💾 محفوظ کریں',
  'Saving...': 'محفوظ ہو رہا ہے...',
  '✓ Saved': '✓ محفوظ',
  '● Not saved': '● ابھی محفوظ نہیں',
  '✅ Trip complete': '✅ ٹرپ مکمل',
  'This trip is completed': 'یہ ٹرپ مکمل ہو گیا ہے',
  'closed by': 'مکمل کیا',
  'Delivery order is uploaded. If the trip is finished, press Trip complete.': 'ڈیلیوری آرڈر لگ گیا ہے۔ اگر ٹرپ ختم ہو گیا ہے تو "ٹرپ مکمل" دبائیں۔',
  'Upload the delivery order receipt': 'ڈیلیوری آرڈر کی رسید لگائیں',
  '📄 Uploaded': '📄 لگ گئی',
  'Trip saved': 'ٹرپ محفوظ ہو گیا',
  '✅ Trip completed': '✅ ٹرپ مکمل ہو گیا',
  'Write From and To first': 'پہلے "کہاں سے" اور "کہاں تک" لکھیں',
  '⋯ More': '⋯ مزید',
  '📎 Import document': '📎 کاغذ لگائیں',
  'one paper or photo': 'ایک کاغذ یا تصویر',
  '🗂 Import documents': '🗂 کئی کاغذ لگائیں',
  'more than one at once': 'ایک ساتھ ایک سے زیادہ',
  '👁 View': '👁 دیکھیں',
  '⬇ Download': '⬇ ڈاؤن لوڈ',
  '🖨 Print': '🖨 پرنٹ',
  '✏️ Edit': '✏️ نام بدلیں',
  '🗑 Delete': '🗑 مٹائیں',
  '✕ Close': '✕ بند کریں',
  'No paper yet.': 'ابھی کوئی کاغذ نہیں۔',
  'papers title': 'کاغذات',
  'Delete this paper?': 'یہ کاغذ مٹائیں؟',
  'Delete': 'مٹائیں',
  'Cancel': 'منسوخ',
  'Save': 'محفوظ کریں',
  'Uploading...': 'لگ رہا ہے...',
  'paper uploaded': 'کاغذ لگ گیا',
  'Paper deleted (the office can still see it)': 'کاغذ مٹ گیا (دفتر اب بھی دیکھ سکتا ہے)',
  'Name changed': 'نام بدل گیا',
  'Edit paper name': 'کاغذ کا نام بدلیں',
  'Name': 'نام',
  'Wrong paper? Delete it and import the right one.': 'غلط کاغذ؟ اسے مٹائیں اور صحیح کاغذ لگائیں۔',
  'This trip is completed. Ask the office to add or change papers.': 'یہ ٹرپ مکمل ہے۔ کاغذ لگانے یا بدلنے کے لیے دفتر سے کہیں۔',
  'The office will still see that it was deleted.': 'دفتر کو پھر بھی پتہ چلے گا کہ یہ مٹایا گیا۔',
  'Opening...': 'کھل رہا ہے...',
  'This file cannot be shown here. Press ⬇ Download.': 'یہ فائل یہاں نہیں کھلتی۔ ⬇ ڈاؤن لوڈ دبائیں۔',
  '📲 Add to my phone': '📲 فون میں شامل کریں',
  'Install': 'انسٹال کریں',
  'puts the icon on your phone': 'آپ کے فون پر آئیکن آ جائے گا',
  'Your password': 'آپ کا پاس ورڈ',
  'Password': 'پاس ورڈ',
  'Open my trips ➜': '⬅ میرے ٹرپ کھولیں',
  'Opening trips...': 'کھل رہا ہے...',
  'Password is wrong. Please try again or ask the office.': 'پاس ورڈ غلط ہے۔ دوبارہ کوشش کریں یا دفتر سے پوچھیں۔',
  'Tap here to install': 'انسٹال کرنے کے لیے یہاں دبائیں',
  'Then press Install on the box that opens': 'پھر کھلنے والے خانے میں Install دبائیں',
  'Open in Chrome first': 'پہلے Chrome میں کھولیں',
  'Open in Safari first': 'پہلے Safari میں کھولیں',
  'Tap the ⋮ menu (top right) and choose Open in Chrome.': 'اوپر دائیں ⋮ دبائیں اور Open in Chrome چنیں۔',
  'Tap the ⋮ menu (top right) and choose Open in Safari.': 'اوپر ⋮ دبائیں اور Open in Safari چنیں۔',
  'Please wait...': 'انتظار کریں...',
  'is on your phone. Use the icon from now on.': 'آپ کے فون پر آ گیا ہے۔ اب سے آئیکن استعمال کریں۔',
  'Driver trip form sub': 'ٹودو نم · ڈرائیور ٹرپ فارم',
  'Add to your phone': 'اپنے فون میں شامل کریں',
  'android steps': 'یہ لنک Chrome میں کھولیں۔ اوپر دائیں ⋮ دبائیں۔ پھر Add to Home screen یا Install app دبائیں، پھر Install۔',
  'ios steps': 'یہ لنک Safari میں کھولیں۔ نیچے Share ⬆️ دبائیں۔ پھر Add to Home Screen دبائیں، پھر Add۔',
  'OK': 'ٹھیک ہے',
  'Log in as': 'اس نام سے لاگ ان کریں:'
};

// box names of the trip form in Urdu (used unless the office renamed the box)
export const UR_LABELS = {
  entry_date: 'تاریخ', from_place: 'کہاں سے', to_place: 'کہاں تک', rent: 'کل کرایہ', driver_allowance: 'ڈرائیور الاؤنس',
  diesel: 'ڈیزل', toll: 'ٹول / دیگر', gate_pass: 'گیٹ پاس', exit_fee: 'ایگزٹ فیس', empty_border_fee: 'بارڈر پر خالی کنٹینر فیس',
  container_wash: 'کنٹینر دھلائی', vehicle_wash: 'گاڑی دھلائی', delivery_order: 'ڈیلیوری آرڈر', _driver_part: 'ٹرپ (ڈرائیور بھرے)'
};

function read() { try { return localStorage.getItem(KEY) === 'ur' ? 'ur' : 'en'; } catch { return 'en'; } }

export function useLang() {
  const [lang, setLangState] = useState('en');
  useEffect(() => {
    setLangState(read());
    const on = () => setLangState(read());
    window.addEventListener('tudo-lang', on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener('tudo-lang', on); window.removeEventListener('storage', on); };
  }, []);
  useEffect(() => {
    if (lang !== 'ur' || document.getElementById('urdu-font')) return;
    const l = document.createElement('link');
    l.id = 'urdu-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap';
    document.head.appendChild(l);
  }, [lang]);
  const setLang = useCallback((v) => { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } setLangState(v); window.dispatchEvent(new Event('tudo-lang')); }, []);
  const t = useCallback((s) => (lang === 'ur' && UR[s] ? UR[s] : s), [lang]);
  return { lang, setLang, t, ur: lang === 'ur' };
}

export function LangSwitch({ className = '' }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Language">
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
      <button type="button" className={`ur-txt${lang === 'ur' ? ' on' : ''}`} aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>اردو</button>
    </div>
  );
}
