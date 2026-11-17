import config from '../config.js';
import { icons, guideIcons } from './icons.js';

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

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export class UiController {
  constructor({ hud, sceneManager, recorder, onStart, onStop }) {
    this.hud = hud;
    this.sceneManager = sceneManager;
    this.recorder = recorder;
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
    this.recordButton = null;
    this.buttons = [];

    this.recordUiActive = false;
    this.recPillSeconds = -1;
    this.flashTimer = null;
    this.resultUrl = null;
    this.resultFile = null;

    this.landing = document.querySelector('#landing');
    this.toolbar = document.querySelector('#toolbar');
    this.toast = document.querySelector('#toast');

    this.recPill = document.querySelector('#rec-pill');
    this.recPillTime = document.querySelector('#rec-pill-time');
    this.flashElement = document.querySelector('#flash');

    this.result = document.querySelector('#result');
    this.resultTitle = document.querySelector('#result-title');
    this.resultPreview = document.querySelector('#result-preview');
    this.resultName = document.querySelector('#result-name');
    this.resultSize = document.querySelector('#result-size');
    this.saveButton = document.querySelector('#result-save');
    this.shareButton = document.querySelector('#result-share');
    this.closeButton = document.querySelector('#result-close');

    this.help = document.querySelector('#help');
    this.helpTitle = document.querySelector('#help-title');
    this.helpCloseButton = document.querySelector('#help-close');
    this.helpContent = document.querySelector('#help-content');
    this.helpCredit = document.querySelector('#help-credit');
    this.helpOpen = false;
    this.helpReturnFocus = null;
    // Keep focus inside the dialog; focusin also catches programmatic shifts.
    this.helpFocusTrap = (event) => {
      if (this.helpOpen && !this.help.contains(event.target)) {
        this.helpCloseButton.focus();
      }
    };

    // The recorder drives the UI when a recording finishes (manual or auto).
    if (this.recorder) {
      this.recorder.onStop = (result) => this.handleRecordingStopped(result);
    }

    this.buildLanding();
    this.buildToolbar();
    this.buildResultCard();
    this.buildHelp();
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

    query('#landing-start-tip').textContent = strings.startTip;

    // One renderer feeds both the landing page and the Help dialog.
    const landingGuide = query('#landing-guide');
    this.renderGuideContent(landingGuide);
    this.renderGuideContent(this.helpContent);

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

  // Shared by the landing page and the Help dialog: the guide data and the
  // markup both have exactly one source.
  renderGuideContent(container) {
    container.textContent = '';

    const howSection = document.createElement('section');
    howSection.className = 'guide-section';
    const howTitle = document.createElement('h2');
    howTitle.className = 'guide-section__title';
    howTitle.textContent = strings.howToUse;

    const grid = document.createElement('div');
    grid.className = 'guide-grid';
    for (const entry of config.ui.guide) {
      const card = document.createElement('article');
      card.className = 'guide-card';

      const icon = document.createElement('span');
      icon.className = 'guide-card__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = guideIcons[entry.id] ?? '';

      const title = document.createElement('h3');
      title.className = 'guide-card__title';
      title.textContent = entry.title;

      const details = document.createElement('dl');
      details.className = 'guide-card__details';
      for (const [key, label, isTip] of [
        ['how', strings.how, false],
        ['result', strings.result, false],
        ['tip', strings.tip, true],
      ]) {
        const row = document.createElement('div');
        row.className = isTip
          ? 'guide-card__row guide-card__row--tip'
          : 'guide-card__row';
        const term = document.createElement('dt');
        term.className = 'guide-card__label';
        term.textContent = label;
        const value = document.createElement('dd');
        value.className = 'guide-card__value';
        value.textContent = entry[key];
        row.append(term, value);
        details.append(row);
      }

      card.append(icon, title, details);
      grid.append(card);
    }
    howSection.append(howTitle, grid);

    const shortcutsSection = document.createElement('section');
    shortcutsSection.className = 'guide-section guide-shortcuts';
    const shortcutsTitle = document.createElement('h2');
    shortcutsTitle.className = 'guide-section__title';
    shortcutsTitle.textContent = strings.keyboardShortcuts;

    const table = document.createElement('table');
    table.className = 'guide-shortcuts__table';
    const body = document.createElement('tbody');
    for (const [key, description] of config.ui.shortcuts) {
      const row = document.createElement('tr');
      const keyCell = document.createElement('td');
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      keyCell.append(kbd);
      const descriptionCell = document.createElement('td');
      descriptionCell.textContent = description;
      row.append(keyCell, descriptionCell);
      body.append(row);
    }
    table.append(body);

    const touchNote = document.createElement('p');
    touchNote.className = 'guide-shortcuts__touch';
    touchNote.textContent = strings.touchShortcuts;

    shortcutsSection.append(shortcutsTitle, table, touchNote);
    container.append(howSection, shortcutsSection);
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
    this.closeHelp();
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
        id: 'record',
        label: strings.toolbar.record,
        icon: icons.record,
        action: () => this.toggleRecord(),
        active: () => Boolean(this.recorder?.isRecording),
      },
      {
        id: 'photo',
        label: strings.toolbar.photo,
        icon: icons.photo,
        action: () => this.takePhoto(),
      },
      {
        id: 'help',
        label: strings.help,
        icon: icons.help,
        action: () => this.openHelp(),
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
      // Recording needs MediaRecorder + canvas captureStream; hide the button
      // entirely when neither is available.
      if (definition.id === 'record' && !this.recorder?.isSupported()) continue;

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
      if (definition.id === 'record') this.recordButton = entry;
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
    this.syncRecordUi();
    this.updateAutoHide();
  }

  // Swaps the Record icon (dot <-> square) and drives the REC pill from the
  // recorder's live state so keyboard shortcuts and auto-stop stay in sync.
  syncRecordUi() {
    const recording = Boolean(this.recorder?.isRecording);

    if (this.recordButton && recording !== this.recordUiActive) {
      this.recordUiActive = recording;
      const icon = this.recordButton.element.querySelector('.toolbar__icon');
      if (icon) icon.outerHTML = recording ? icons.recordActive : icons.record;
    }

    if (recording) {
      if (this.recPill.hidden) this.recPill.hidden = false;
      const seconds = Math.floor(this.recorder.elapsedMs / 1000);
      if (seconds !== this.recPillSeconds) {
        this.recPillSeconds = seconds;
        this.recPillTime.textContent = `${strings.recording.rec} ${formatClock(seconds)}`;
      }
    } else if (!this.recPill.hidden) {
      this.hideRecPill();
    }
  }

  hideRecPill() {
    this.recPill.hidden = true;
    this.recPillSeconds = -1;
  }

  // --- Record / Photo --------------------------------------------------------

  toggleRecord() {
    if (!this.recorder) return;
    if (!this.recorder.isSupported()) {
      this.showToast(strings.toast.recordingUnsupported);
      return;
    }

    if (this.recorder.isRecording) {
      this.recorder.stop();
    } else {
      this.startRecording();
    }
    this.markActivity();
  }

  async startRecording() {
    try {
      await this.recorder.start();
      this.showToast(strings.toast.recordingStarted);
    } catch {
      this.showToast(strings.toast.recordingUnsupported);
    }
    this.syncRecordUi();
    this.markActivity();
  }

  // Called by the recorder whenever a recording finishes (manual stop or the
  // maxSeconds auto-stop), so both paths behave identically.
  handleRecordingStopped(result) {
    this.syncRecordUi();
    if (!result) return;
    this.showResult(result, 'video');
    this.showToast(strings.toast.recordingStopped);
  }

  async takePhoto() {
    if (!this.recorder) return;
    this.flash();
    this.markActivity();

    const photo = await this.recorder.takePhoto();
    if (!photo?.blob) return;

    this.showResult(photo, 'photo');
    this.showToast(strings.toast.photoCaptured);
  }

  // Short white flash overlay shown when a photo is captured.
  flash() {
    this.flashElement.classList.remove('is-visible');
    // Force a reflow so the animation restarts on a rapid second capture.
    void this.flashElement.offsetWidth;
    this.flashElement.classList.add('is-visible');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashElement.classList.remove('is-visible');
    }, 150);
  }

  // --- Result card -----------------------------------------------------------

  buildResultCard() {
    this.resultTitle.textContent = '';
    this.saveButton.textContent = strings.recording.save;
    this.shareButton.textContent = strings.recording.share;
    this.closeButton.textContent = strings.recording.close;

    this.saveButton.addEventListener('click', () => this.saveResult());
    this.shareButton.addEventListener('click', () => this.shareResult());
    this.closeButton.addEventListener('click', () => this.closeResult());
    this.result.addEventListener('click', (event) => {
      if (event.target === this.result) this.closeResult();
    });
  }

  showResult({ blob, filename, mimeType }, kind) {
    this.closeResult();

    const type = blob.type || mimeType || '';
    const url = URL.createObjectURL(blob);
    this.resultUrl = url;
    this.resultKind = kind;

    this.resultTitle.textContent =
      kind === 'photo' ? strings.recording.photoTitle : strings.recording.videoTitle;

    this.resultPreview.textContent = '';
    let media;
    if (kind === 'photo') {
      media = document.createElement('img');
      media.alt = filename;
      media.src = url;
    } else {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.src = url;
    }
    media.className = 'result__media';
    this.resultPreview.append(media);

    this.resultName.textContent = filename;
    this.resultSize.textContent = formatBytes(blob.size);

    this.resultFile = new File([blob], filename, { type });
    let canShare = false;
    try {
      canShare = Boolean(
        navigator.canShare && navigator.canShare({ files: [this.resultFile] }),
      );
    } catch {
      canShare = false;
    }
    this.shareButton.hidden = !canShare;

    this.result.hidden = false;
  }

  saveResult() {
    if (!this.resultUrl || !this.resultFile) return;
    const link = document.createElement('a');
    link.href = this.resultUrl;
    link.download = this.resultFile.name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  }

  async shareResult() {
    if (!this.resultFile) return;
    try {
      await navigator.share({ files: [this.resultFile] });
    } catch {
      // User dismissed the share sheet or sharing failed; nothing to do.
    }
  }

  closeResult() {
    if (this.resultUrl) {
      URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = null;
    }
    this.resultFile = null;
    this.resultPreview.textContent = '';
    this.result.hidden = true;
  }

  isResultOpen() {
    return !this.result.hidden;
  }

  // --- Help dialog -----------------------------------------------------------

  buildHelp() {
    this.helpTitle.textContent = strings.help;
    this.helpCredit.textContent = config.ui.credit;
    this.helpCloseButton.setAttribute('aria-label', strings.closeHelp);
    this.helpCloseButton.innerHTML = icons.close;
    this.helpCloseButton.addEventListener('click', () => this.closeHelp());
    this.help.addEventListener('click', (event) => {
      if (event.target === this.help) this.closeHelp();
    });
  }

  openHelp() {
    if (this.helpOpen) return;
    this.helpReturnFocus = document.activeElement;
    this.helpOpen = true;
    this.help.hidden = false;
    document.addEventListener('focusin', this.helpFocusTrap);
    this.markActivity();
    this.helpCloseButton.focus();
  }

  closeHelp() {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    this.help.hidden = true;
    document.removeEventListener('focusin', this.helpFocusTrap);
    const returnTo = this.helpReturnFocus;
    this.helpReturnFocus = null;
    if (
      returnTo &&
      typeof returnTo.focus === 'function' &&
      document.contains(returnTo)
    ) {
      returnTo.focus();
    }
    this.markActivity();
  }

  toggleHelp() {
    if (this.helpOpen) {
      this.closeHelp();
    } else {
      this.openHelp();
    }
  }

  isHelpOpen() {
    return this.helpOpen;
  }

  // Stop button / session teardown: discard any active recording without a
  // result card, close the card, and release the offscreen canvas.
  resetCapture() {
    this.recorder?.cancel();
    this.recorder?.releaseCanvas();
    this.closeResult();
    this.hideRecPill();
    this.flashElement.classList.remove('is-visible');

    this.recordUiActive = false;
    if (this.recordButton) {
      const icon = this.recordButton.element.querySelector('.toolbar__icon');
      if (icon) icon.outerHTML = icons.record;
    }
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
    this.setToolbarHidden(
      idle && !this.pressed && !this.stopArmed && !this.helpOpen,
    );
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
