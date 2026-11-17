// Inline SVG icons (24x24, currentColor) used by the bottom toolbar.
// No icon font or external asset is required.

const svg = (paths) =>
  `<svg class="toolbar__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const guideSvg = (paths) =>
  `<svg class="guide-card__svg" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  // Thermometer: thermal filter.
  thermal: svg(
    '<path d="M10 13.6V5.5a2 2 0 0 1 4 0v8.1a4 4 0 1 1-4 0Z"/><path d="M12 9.5v5.5"/>',
  ),

  // Paint palette: color palette cycling.
  palette: svg(
    '<path d="M12 3a9 9 0 0 0 0 18h1.4a2.4 2.4 0 0 0 1.9-3.9 2.4 2.4 0 0 1 1.9-3.9H18A3 3 0 0 0 21 10.2 9 9 0 0 0 12 3Z"/><circle cx="7.6" cy="11.4" r="1.1"/><circle cx="10.4" cy="7.8" r="1.1"/><circle cx="15" cy="8.3" r="1.1"/>',
  ),

  // Map pin: persistent (kalıcı) mode.
  persist: svg(
    '<path d="M12 21s6-5.4 6-9.8a6 6 0 1 0-12 0C6 15.6 12 21 12 21Z"/><circle cx="12" cy="11.2" r="2.1"/>',
  ),

  // Trash: clear frozen shapes.
  clear: svg(
    '<path d="M4 7h16"/><path d="M9.5 7V5.4a1.4 1.4 0 0 1 1.4-1.4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M6.5 7l1 12.2a1.4 1.4 0 0 0 1.4 1.3h6.2a1.4 1.4 0 0 0 1.4-1.3L18 7"/>',
  ),

  // Hand with landmark dots: HUD toggle.
  landmarks: svg(
    '<path d="M9 11.5V6.2a1.4 1.4 0 0 1 2.8 0v3.9"/><path d="M11.8 10.2V5.2a1.4 1.4 0 0 1 2.8 0v5"/><path d="M14.6 10.2V7.4a1.4 1.4 0 0 1 2.8 0v6.2a6 6 0 0 1-6 6h-.6a6 6 0 0 1-6-6v-2.4a1.4 1.4 0 0 1 2.8 0"/><circle cx="10" cy="7.2" r="0.6"/><circle cx="13.4" cy="6.6" r="0.6"/>',
  ),

  // Bug: debug text toggle.
  debug: svg(
    '<circle cx="12" cy="13" r="5"/><path d="M12 8V5"/><path d="M8.2 10.2 5.8 8"/><path d="M15.8 10.2 18.2 8"/><path d="M7 13H4"/><path d="M20 13h-3"/><path d="M8.2 15.8 5.8 18"/><path d="M15.8 15.8 18.2 18"/><path d="M9.6 11.5h4.8"/>',
  ),

  // Expand corners: fullscreen toggle.
  fullscreen: svg(
    '<path d="M4 9V5.4A1.4 1.4 0 0 1 5.4 4H9"/><path d="M15 4h3.6A1.4 1.4 0 0 1 20 5.4V9"/><path d="M20 15v3.6a1.4 1.4 0 0 1-1.4 1.4H15"/><path d="M9 20H5.4A1.4 1.4 0 0 1 4 18.6V15"/>',
  ),

  // Stop square: end the session and return to the landing page.
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/>'),

  // Record: a filled red dot (the button color is set in CSS).
  record: svg('<circle cx="12" cy="12" r="6.2" fill="currentColor" stroke="none"/>'),

  // Record active: a filled square shown while recording.
  recordActive: svg(
    '<rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none"/>',
  ),

  // Photo: camera aperture/shutter.
  photo: svg(
    '<path d="M4 8.6A1.6 1.6 0 0 1 5.6 7h2.1l1.1-1.6A1.4 1.4 0 0 1 10 4.8h4a1.4 1.4 0 0 1 1.2.6L16.3 7h2.1A1.6 1.6 0 0 1 20 8.6v8.8A1.6 1.6 0 0 1 18.4 19H5.6A1.6 1.6 0 0 1 4 17.4Z"/><circle cx="12" cy="12.6" r="3.3"/>',
  ),

  // Question mark: open the Help dialog.
  help: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3 1-1.3 2"/><circle cx="12" cy="17.1" r="0.8" fill="currentColor" stroke="none"/>',
  ),

  // X: close the Help dialog.
  close: svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
};

// Small line pictograms shown once per gesture in the guide cards. They are
// keyed by config.ui.guide[].id so the guide text stays data-only.
export const guideIcons = {
  'l-frame': guideSvg(
    '<path d="M4 4v9h7"/><path d="M20 20v-9h-7"/><path d="M11 13h2"/>',
  ),
  'v-sign': guideSvg(
    '<path d="m7 5 5 12 5-12"/><path d="M9 20h6"/><path d="M12 17v3"/>',
  ),
  fist: guideSvg(
    '<path d="M7 12V9a1.5 1.5 0 0 1 3 0v2"/><path d="M10 11V7.5a1.5 1.5 0 0 1 3 0V11"/><path d="M13 11V8.5a1.5 1.5 0 0 1 3 0V13"/><path d="M16 13v-1.5a1.5 1.5 0 0 1 3 0V16a4 4 0 0 1-4 4h-4a5 5 0 0 1-5-5v-2a1.5 1.5 0 0 1 3 0"/>',
  ),
  'open-hands': guideSvg(
    '<path d="M3 14V9a1.3 1.3 0 0 1 2.6 0v3"/><path d="M5.6 12V7a1.3 1.3 0 0 1 2.6 0v5"/><path d="M8.2 12V8.5a1.3 1.3 0 0 1 2.6 0V16a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-2"/><path d="M21 14V9a1.3 1.3 0 0 0-2.6 0v3"/><path d="M18.4 12V7a1.3 1.3 0 0 0-2.6 0v5"/><path d="M15.8 12V8.5a1.3 1.3 0 0 0-2.6 0V16a4 4 0 0 0 4 4h.6a4 4 0 0 0 4-4v-2"/>',
  ),
  sweep: guideSvg(
    '<path d="M3 8h15"/><path d="m15 4 4 4-4 4"/><path d="M5 14h11"/><path d="M7 19h7"/>',
  ),
  persist: guideSvg(
    '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><rect x="7.5" y="7.5" width="13" height="13" rx="2"/><circle cx="20.2" cy="4.2" r="0.9" fill="currentColor" stroke="none"/>',
  ),
};
