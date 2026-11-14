// Inline SVG icons (24x24, currentColor) used by the bottom toolbar.
// No icon font or external asset is required.

const svg = (paths) =>
  `<svg class="toolbar__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

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
};
