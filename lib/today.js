/* Today's date in Muscat for every AI prompt (Kamran 6 Nov 2026: "AI must always have the latest date").
   Without it the AI guesses the year and calls real dates "in the future". */
export function muscatTodayISO() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Muscat' }).slice(0, 10);
}
export function todayLine() {
  const iso = muscatTodayISO();
  const [y, m, d] = iso.split('-');
  return `Today's date is ${d}/${m}/${y} (dd/mm/yyyy, Muscat time). Use it when you judge dates: a date on or before today is NOT in the future.\n`;
}
