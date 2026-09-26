/* Investus – Icons der Bausteine statt Farbquadrate (eigene Zeichnung, 24er Raster, Farbe = currentColor).
   INV_ICON(a): a = ftse (Weltkugel) | btc (₿ im Ring) | gold (Goldbarren) | cash (€ im Ring) | alt (Punkt für ETH/SOL).
   Weltkugel: Kontinente aus echten Küstenpunkten (orthografisch, 18° W / 10° N), geglättet, als Aussparung. */
(function (root) {
  'use strict';
  var SV = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
  var uid = 0;
  var LAND = 'M2.90 10.72 2.58 10.90 2.20 11.32 1.82 12.62 2.00 14.05 2.42 15.55 3.42 17.52 4.12 18.50 5.50 19.88 5.97 20.23 6.28 20.20 6.65 20.00 7.08 19.57 8.62 17.30 9.07 15.75 9.07 15.18 8.95 14.78 8.40 14.12 6.95 13.30 5.88 12.07 4.75 11.12 3.85 10.70ZM12.88 7.75 12.07 8.88 11.78 9.78 11.75 11.00 12.05 11.93 12.75 12.80 13.57 13.30 14.20 13.43 15.80 13.30 16.38 13.60 16.70 14.25 16.98 15.20 16.82 17.68 17.05 18.75 17.45 19.27 17.85 19.48 18.55 19.48 19.10 19.23 19.73 18.68 20.35 17.88 21.12 16.57 21.57 15.55 21.88 13.93 22.15 13.07 22.15 11.05 21.30 11.07 20.68 10.60 18.70 7.67 16.95 7.65 16.12 7.28 15.70 7.20 14.47 7.62ZM8.05 3.20 7.75 2.92 7.50 2.85 6.12 3.65 4.60 4.97 4.55 5.12 4.72 5.53 5.22 5.90 5.80 5.95 6.95 5.55 7.65 5.17 8.07 4.70 8.25 4.22 8.25 3.67ZM14.15 2.52 13.93 3.08 13.88 3.75 13.43 4.75 13.07 6.28 13.10 6.60 14.22 6.53 15.70 6.03 16.52 6.22 17.23 6.55 19.15 6.60 19.73 7.12 21.38 9.72 21.62 9.95 21.98 9.95 21.57 8.45 20.88 6.95 19.88 5.50 18.98 4.55 17.88 3.65 16.27 2.73 14.78 2.17 14.47 2.23Z';
  var BAR = 'M1.88 14.37 4.18 10.06 17.00 5.68 19.68 8.93 21.95 13.60 5.80 19.12Z', BAR_LIGHT = 'M6.87 13.61 18.54 9.16 18.50 9.04 6.55 12.67ZM7.09 12.82 4.04 9.82 3.95 9.90 6.32 13.46ZM6.21 13.05 5.61 19.18 5.73 19.20 7.20 13.22Z', BAR_W = '1.80';
  var BTC = 'M7.2 6.4H13C14.6 6.4 15.6 7.4 15.6 8.7C15.6 9.9 15 10.8 14.1 11.2C15.5 11.6 16.4 12.6 16.4 14.1C16.4 16.2 15 17.6 13.2 17.6H7.2V15.7H8.6V8.3H7.2ZM10.9 8.3H12.9C13.5 8.3 13.8 8.8 13.8 9.55C13.8 10.3 13.4 10.8 12.8 10.8H10.9ZM10.9 12.7H13.4C14.1 12.7 14.5 13.3 14.5 14.15C14.5 15.05 14 15.7 13.3 15.7H10.9ZM8.9 4.5H10.6V6.4H8.9ZM11.9 4.5H13.6V6.4H11.9ZM8.9 17.6H10.6V19.5H8.9ZM11.9 17.6H13.6V19.5H11.9Z';
  var RING = '<circle cx="12" cy="12" r="10.35" fill="none" stroke="currentColor" stroke-width="1.4"/>';
  function icon(a) {
    var id = 'ii' + (++uid);
    if (a === 'ftse') return SV + '><mask id="' + id + '"><circle cx="12" cy="12" r="11.2" fill="#fff"/><path d="' + LAND + '" fill="#000"/></mask>' +
      '<circle cx="12" cy="12" r="11.2" fill="currentColor" mask="url(#' + id + ')"/></svg>';
    if (a === 'btc') return SV + '>' + RING + '<path d="' + BTC + '" fill="currentColor" fill-rule="evenodd" transform="translate(.2 0)"/></svg>';
    if (a === 'gold') return SV + '><path d="' + BAR + '" fill="currentColor" stroke="currentColor" stroke-width="' + BAR_W + '" stroke-linejoin="round"/>' +
      '<path d="' + BAR_LIGHT + '" fill="#fff" fill-opacity=".85"/></svg>';
    if (a === 'cash') return SV + '>' + RING + '<g fill="none" stroke="currentColor"><path d="M16.9 7.7A5.6 5.6 0 1 0 16.9 16.3" stroke-width="2.2"/><path d="M6.4 10.7H13.4M6.4 13.3H13.4" stroke-width="1.8"/></g></svg>';
    return SV + '><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>';
  }
  root.INV_ICON = icon;
})(typeof window !== 'undefined' ? window : globalThis);
