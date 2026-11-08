// Money as the designer writes it: a currency symbol set once in "You, the designer" (Brief page),
// "$" until they choose. Unit prices are starting points they edit for their own area.
let symbol = '$';
export const setCurrency = (s?: string | null) => { symbol = (s || '').trim().slice(0, 4) || '$'; };
export const currency = () => symbol;
export const money = (v: number) => `${symbol}${Math.round(v).toLocaleString()}`;
