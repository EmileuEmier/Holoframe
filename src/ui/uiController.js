import config from '../config.js';
import { icons } from './icons.js';

const strings = config.ui.strings;

function isFullscreenSupported() {
  const element = document.documentElement;
  return Boolean(
    document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      element.requestFullscreen ||
      element.webkitRequestFullscreen,
  );
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export class UiController {
  constructor({ hud, sceneManager, onStart, onStop }) {
    this.hud = hud;
    this.sceneManager = sceneManager;
    this.onStart = onStart;
    this.onStop = onStop;

    this.fullscreenSupported = isFullscreenSupported();
    this.pressed = false;
    this.lastActivity = performance.now();
    this.toolbarHidden = false;
    this.toastTimer = null;
    this.hintShown = false;
    this.stopArmed = false;
    this.stopTimer = null;
    this.landingHideTimer = null;
    this.stopButton = null;
    this.buttons = [];

    this.landing = document.querySelector('#landing');
    this.toolbar = document.querySelector('#toolbar');
    this.toast = document.querySelector('#toast');

    this.buildLanding();
    this.buildToolbar();
    this.bindActivity();
    this.bindFullscreenEvents();
  }

  // --- Landing ---------------------------------------------------------------

  buildLanding() {
    const query = (selector) => this.landing.querySelector(selector);

    query('#landing-title').textContent = strings.title;
    query('#landing-tagline').textContent = strings.tagline;
    query('#landing-privacy').textContent = strings.privacy;
    query('#landing-credit').textContent = config.ui.credit;
    query('#landing-fullscreen-label').textContent = strings.startFullscreen;

    const list = query('#landing-gestures');
    list.textContent = '';
    for (const gesture of strings.gestures) {
      const item = document.createElement('li');
      item.className = 'gesture-card';

      const title = document.createElement('span');
      title.className = 'gesture-card__title';
      title.textContent = gesture.title;

      const description = document.createElement('span');
      description.className = 'gesture-card__desc';
      description.textContent = gesture.description;

      item.append(title, description);
      list.append(item);
    }

    this.fullscreenRow = query('#landing-fullscreen-row');
    this.fullscreenCheckbox = query('#landing-fullscreen');
    if (this.fullscreenSupported) {
      this.fullscreenCheckbox.checked = config.ui.startFullscreenDefault;
    } else {
      this.fullscreenRow.hidden = true;
    }

    this.startButton = query('#landing-start');
    this.startButton.textContent = strings.start;
    this.startButton.addEventListener('click', () => this.onStart?.());

    this.errorElement = query('#landing-error');
    this.retryButton = query('#landing-retry');
    this.retryButton.textContent = strings.retry;
    this.retryButton.addEventListener('click', () => {
      this.hideError();
      this.onStart?.();
    });
  }

  shouldStartFullscreen() {
    return this.fullscreenSupported && this.fullscreenCheckbox.checked;
  }

  setLoading(message) {
    this.hideError();
    this.startButton.disabled = true;
    this.startButton.classList.add('is-busy');
    this.startButton.textContent = message;
  }

  resetStartButton() {
    this.startButton.disabled = false;
    this.startButton.classList.remove('is-busy');
    this.startButton.textContent = strings.start;
  }

  showError(message) {
    this.resetStartButton();
    this.errorElement.textContent = message;
    this.errorElement.hidden = false;
    this.retryButton.hidden = false;
  }

  hideError() {
    this.errorElement.hidden = true;
    this.retryButton.hidden = true;
  }

  finishStart() {
    this.landing.classList.add('is-hidden');
    this.toolbar.hidden = false;
    this.lastActivity = performance.now();
    this.setToolbarHidden(false);
    window.clearTimeout(this.landingHideTimer);
    this.landingHideTimer = window.setTimeout(() => {
      this.landing.hidden = true;
    }, 450);

    // iPhone Safari has no Fullscreen API: tell the user once how to get the
    // fullscreen experience instead of showing a dead button.
    if (!this.fullscreenSupported && !this.hintShown) {
      this.hintShown = true;
      this.showToast(strings.fullscreenHint);
    }
  }

  // Return to the landing page and hide the toolbar for a clean restart.
  showLanding() {
    this.resetStop();
    window.clearTimeout(this.landingHideTimer);
    this.landingHideTimer = null;
    this.toolbar.hidden = true;
    this.setToolbarHidden(false);
    this.landing.hidden = false;
    // Force a reflow so the fade-in transition runs again.
    void this.landing.offsetWidth;
    this.landing.classList.remove('is-hidden');
    this.resetStartButton();
    this.hideError();
  }

  // --- Toolbar ---------------------------------------------------------------

  buildToolbar() {
    const definitions = [
      {
        id: 'thermal',
        label: strings.toolbar.thermal,
        icon: icons.thermal,
        action: () => this.sceneManager.toggleThermal(),
        active: () => this.sceneManager.getThermalDebug().enabled,
        toast: (on) => (on ? strings.toast.thermalOn : strings.toast.thermalOff),
      },
      {
        id: 'palette',
        label: strings.toolbar.palette,
        icon: icons.palette,
        action: () => this.sceneManager.cycleThermalPalette(),
        toast: (name) => strings.toast.palette.replace('{name}', name ?? '-'),
      },
      {
        id: 'persist',
        label: strings.toolbar.persist,
        icon: icons.persist,
        action: () => this.sceneManager.togglePersist(),
        active: () => this.sceneManager.getPersistDebug().enabled,
        toast: (on) => (on ? strings.toast.persistOn : strings.toast.persistOff),
      },
      {
        id: 'clear',
        label: strings.toolbar.clear,
        icon: icons.clear,
        action: () => this.sceneManager.clearStamps(),
        toast: () => strings.toast.clear,
      },
      {
        id: 'landmarks',
        label: strings.toolbar.landmarks,
        icon: icons.landmarks,
        action: () => this.hud.toggle(),
        active: () => this.hud.enabled,
        toast: (on) =>
          on ? strings.toast.landmarksOn : strings.toast.landmarksOff,
      },
      {
        id: 'debug',
        label: strings.toolbar.debug,
        icon: icons.debug,
        action: () => this.hud.toggleDebugText(),
        active: () => this.hud.debugTextEnabled,
        toast: (on) => (on ? strings.toast.debugOn : strings.toast.debugOff),
      },
      {
        id: 'fullscreen',
        label: strings.toolbar.fullscreen,
        icon: icons.fullscreen,
        action: () => this.toggleFullscreen(),
        active: () => Boolean(getFullscreenElement()),
      },
      {
        id: 'stop',
        label: strings.toolbar.stop,
        icon: icons.stop,
        action: () => this.handleStop(),
      },
    ];

    for (const definition of definitions) {
      if (definition.id === 'fullscreen' && !this.fullscreenSupported) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toolbar__button';
      button.dataset.action = definition.id;
      button.setAttribute('aria-label', definition.label);
      button.innerHTML = `${definition.icon}<span class="toolbar__label">${definition.label}</span>`;
      button.addEventListener('click', () => this.handleButton(definition));
      this.toolbar.append(button);

      const entry = { definition, element: button };
      this.buttons.push(entry);
      if (definition.id === 'stop') this.stopButton = entry;
    }
  }

  handleButton(definition) {
    const result = definition.action();
    if (definition.toast) {
      this.showToast(definition.toast(result));
    }
    this.markActivity();
    this.sync();
  }

  // Reads the live state each frame so keyboard and gesture changes stay in
  // sync without keeping a second copy of the state here.
  sync() {
    for (const { definition, element } of this.buttons) {
      if (!definition.active) continue;
      const active = Boolean(definition.active());
      element.classList.toggle('is-active', active);
      element.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    this.updateAutoHide();
  }

  // --- Stop (two-tap confirm) ------------------------------------------------

  handleStop() {
    if (this.stopArmed) {
      this.disarmStop();
      this.onStop?.();
      return;
    }

    this.stopArmed = true;
    this.stopButton.element.classList.add('is-armed');
    this.setStopLabel(strings.stopConfirm);
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(
      () => this.disarmStop(),
      config.ui.stopConfirmMs,
    );
    this.markActivity();
  }

  disarmStop() {
    this.stopArmed = false;
    window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (!this.stopButton) return;
    this.stopButton.element.classList.remove('is-armed');
    this.setStopLabel(strings.toolbar.stop);
  }

  resetStop() {
    this.disarmStop();
  }

  setStopLabel(label) {
    const text = this.stopButton.element.querySelector('.toolbar__label');
    if (text) text.textContent = label;
    this.stopButton.element.setAttribute('aria-label', label);
  }

  // --- Auto-hide -------------------------------------------------------------

  bindActivity() {
    const onActivity = () => this.markActivity();
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'touchstart',
      'touchmove',
      'keydown',
      'wheel',
    ]) {
      window.addEventListener(type, onActivity, { passive: true });
    }

    this.toolbar.addEventListener('pointerdown', () => {
      this.pressed = true;
      this.markActivity();
    });
    window.addEventListener('pointerup', () => {
      this.pressed = false;
      this.markActivity();
    });
    window.addEventListener('pointercancel', () => {
      this.pressed = false;
    });
  }

  markActivity() {
    this.lastActivity = performance.now();
    this.setToolbarHidden(false);
  }

  updateAutoHide() {
    if (this.toolbar.hidden) return;
    const idle = performance.now() - this.lastActivity > config.ui.autoHideMs;
    this.setToolbarHidden(idle && !this.pressed && !this.stopArmed);
  }

  setToolbarHidden(hidden) {
    if (this.toolbarHidden === hidden) return;
    this.toolbarHidden = hidden;
    this.toolbar.classList.toggle('is-hidden', hidden);
  }

  // --- Toast -----------------------------------------------------------------

  showToast(message) {
    if (!message) return;
    this.toast.textContent = message;
    this.toast.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove('is-visible');
    }, config.ui.toastMs);
  }

  // --- Fullscreen ------------------------------------------------------------

  bindFullscreenEvents() {
    const handler = () => {
      // Keep the button highlight correct; the resize is handled in main.js.
      this.sync();
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
  }

  async requestFullscreen() {
    if (getFullscreenElement()) return;
    const element = document.documentElement;
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      }
    } catch {
      // Fullscreen can be rejected (e.g. not allowed); the app still works.
    }
  }

  async toggleFullscreen() {
    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } else {
        await this.requestFullscreen();
      }
    } catch {
      // Ignore; the 'fullscreenchange' event keeps the button state correct.
    }
  }
}
