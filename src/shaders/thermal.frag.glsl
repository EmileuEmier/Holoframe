uniform sampler2D uMap;
uniform float uMix;
uniform float uTime;
uniform float uContrast;
uniform float uGamma;
uniform float uBands;
uniform float uShimmer;
uniform vec3 uPalette[5];
uniform int uPaletteSize;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 paletteRamp(float t) {
  float maxIndex = float(max(uPaletteSize - 1, 1));
  float scaled = clamp(t, 0.0, 1.0) * maxIndex;
  vec3 color = uPalette[0];

  // Constant loop indices keep this compatible with GLSL ES 1.00 while
  // uPaletteSize still allows shorter palettes.
  for (int i = 1; i < 5; i++) {
    if (i < uPaletteSize) {
      float f = clamp(scaled - float(i - 1), 0.0, 1.0);
      color = mix(color, uPalette[i], f);
    }
  }

  return color;
}

void main() {
  // Three.js uploads VideoTexture with a linear transfer, so this sample is
  // already in display/sRGB space. The palette is built in the same space.
  vec3 original = texture2D(uMap, vUv).rgb;
  float lum = dot(original, LUMA);

  lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);
  lum = pow(lum, max(uGamma, 0.001));

  if (uBands > 0.5) {
    float bands = max(2.0, floor(uBands + 0.5));
    float level = min(bands - 1.0, floor(lum * bands));
    lum = level / (bands - 1.0);
  }

  vec3 thermal = paletteRamp(lum);

  if (uShimmer > 0.0) {
    float scan = sin((vUv.y * 720.0 + uTime * 4.0) * 6.2831853);
    float noise = fract(
      sin(dot(vUv * vec2(12.9898, 78.233) + uTime * 0.013, vec2(43758.5453))) *
        43758.5453
    );
    thermal += (scan * 0.6 + (noise - 0.5) * 0.8) * uShimmer * 0.5;
  }

  vec3 color = mix(original, thermal, clamp(uMix, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
}
