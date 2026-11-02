/*
  Short details of a scanned bill (Kamran 2 Nov 2026: "we need particular information only"):
  Receipt No. (number printed on the paper), Vehicle No. (number plate), Fuel, VAT No., Amount.
  Shown in the Payment receipts / Invoices list and in a small box under the paper. NOT printed on the letterhead.
  Kept in company_docs.scan as { receipt_no, vehicle_no, fuel, vat_no, amount, vat_amount }.
  Older imports kept the long AI result (doc_no, vehicle_no, vendor_vat, total, items): read from those too.
*/

/* MOGAS 91 / 95 / 98, M91, Super, Regular, Petrol = Petrol. Diesel, Gasoil = Diesel. */
export function fuelOf(text) {
  const t = String(text || '').toLowerCase();
  if (/diesel|deisel|desiel|gas ?oil|gasoil/.test(t)) return 'Diesel';
  if (/mogas|petrol|gasoline|\bm ?9[158]\b|\b9[158]\b|super|regular|special/.test(t)) return 'Petrol';
  return '';
}

export const FUELS = ['Petrol', 'Diesel'];

export function shortOf(doc) {
  const s = doc?.scan || {};
  const items = Array.isArray(s.items) ? s.items : Array.isArray(doc?.items) ? doc.items : [];
  const amount = s.amount ?? s.total ?? null;
  return {
    receipt_no: s.receipt_no ?? s.doc_no ?? '',
    vehicle_no: s.vehicle_no ?? '',
    fuel: s.fuel ?? fuelOf(items.map((i) => i.desc).join(' ')),
    vat_no: s.vat_no ?? s.vendor_vat ?? doc?.party_vat ?? '',
    amount: amount === '' ? null : amount,
    vat_amount: s.vat_amount ?? null
  };
}

export const hasShort = (doc) => {
  const x = shortOf(doc);
  return !!(x.receipt_no || x.vehicle_no || x.fuel || x.vat_no || (x.amount !== null && x.amount !== undefined));
};
