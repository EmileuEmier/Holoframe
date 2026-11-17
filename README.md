# 🌌 Holoframe

Holoframe is an interactive, browser-based holographic UI and gesture-recognition web application built with **Three.js** and **MediaPipe**. By using your web camera, it tracks your hand movements in real-time to generate dynamic 3D geometric shapes, interactive panels, and visual effects right in your browser.

🌐 **Live Demo:** [https://emileuemier.github.io/Holoframe/](https://emileuemier.github.io/Holoframe/)

---

## ✨ Features

* **Real-time Hand Tracking:** Powered by MediaPipe Tasks Vision for smooth, low-latency hand landmark detection.
* **Holographic 3D Interaction:** Draw and manipulate shapes, panels, and prisms using natural hand gestures.
* **Thermal Camera Filter:** Toggleable thermal camera view with multiple color palettes.
* **Persist Mode:** Keep generated shapes frozen on screen even after dropping your hands.
* **Full Keyboard & Gesture Control:** Comprehensive shortcut support for seamless experimentation.

---

## ✋ Hand Gestures

| Gesture | How to Perform | Result |
| :--- | :--- | :--- |
| **Two-hand L frame** | Make an L with the thumb and index finger of both hands and hold them apart. | A panel appears between your fingertips (side-by-side or stacked changes color; flip a hand to twist). |
| **V sign** | Raise your index and middle fingers in a V. | A glowing triangle connects your thumb, index, and middle fingertips. |
| **Fist** | Close your hand in a fist and hold it for about half a second. | Toggles the thermal camera filter on and off. |
| **Two open hands** | Show both hands open and move them apart. | A pentagonal prism stretches between your ten fingertips. |
| **Open-hand sweep** | Swipe an open hand quickly across the screen. | Clears all shapes left on the screen. |
| **Persist mode** | Turn on via `C` key or toolbar button. | Panels and triangles stay on screen (keeps up to 12 shapes). |

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| **`T`** | Thermal filter on/off |
| **`P`** | Next thermal palette |
| **`C`** | Persist mode on/off |
| **`X`** | Clear all shapes |
| **`H`** | Hand points on/off |
| **`D`** | Debug text on/off |
| **`B`** | Prism view: Face / Screen lens |
| **`R`** | Start / stop recording |
| **`V`** | Take a photo |
| **`F`** | Fullscreen |
| **`Esc`** | Exit fullscreen / close dialogs |

---

## 🛠️ Built With

* **Vite** - Frontend build tool
* **Three.js** - 3D graphics rendering
* **MediaPipe Tasks Vision** - Hand landmark detection model (`hand_landmarker.task`)
* **HTML5 / CSS3 / JavaScript (ES Modules)**