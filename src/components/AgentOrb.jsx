import { useEffect, useRef } from "react";
import { ORB_THEME } from "../config/agent";
import { getDailyOrbTheme } from "../config/dailyOrbTheme";

export const AGENT_ORB_STYLE = `
  .agent-orb-launcher {
    transition: filter 200ms ease;
  }
  .agent-orb-launcher:hover {
    filter: brightness(1.25);
  }
  .agent-orb-canvas {
    animation: agent-orb-breathe 7s ease-in-out infinite;
    transform-origin: 50% 50%;
  }
  @keyframes agent-orb-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.025); }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-orb-canvas {
      animation: none;
    }
  }
`;

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Classic Ashima Arts 3D simplex noise — public-domain-equivalent (MIT),
// the standard building block for shader noise, not anything bespoke here.
// fbm (fractal Brownian motion — several octaves of the same noise summed
// at shrinking amplitude/growing frequency) is what turns one smooth noise
// field into the layered, organic detail marble actually needs.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform vec3 uColorFar;
  uniform vec3 uColorNear;
  uniform float uBrightness;

  // uColorFar/uColorNear arrive as sRGB (that's what's in agent.config.json
  // and what CSS/screens expect for final display) — but mixing/lighting
  // math needs to happen in LINEAR space, not sRGB. sRGB is a gamma-encoded,
  // perceptual curve; linearly interpolating two colors while they're still
  // gamma-encoded produces a muddy, grayed-out middle instead of a clean
  // transition (confirmed by sampling actual rendered pixels: midtones came
  // out as dull grayish-olive like (49,76,69) instead of clean navy/green).
  // Convert to linear on the way in, do all the ramp/shading math there,
  // convert back to sRGB on the way out for display.
  vec3 srgbToLinear(vec3 c){ return pow(c, vec3(2.2)); }
  vec3 linearToSrgb(vec3 c){ return pow(max(c, vec3(0.0)), vec3(1.0/2.2)); }

  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p){
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++){
      v += amp * snoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return v;
  }

  // Triangle wave (0 -> 1 -> 0, linearly) instead of sin()+asin(): moves
  // through every value at a constant rate, so its output is naturally,
  // perfectly uniformly distributed — no distribution-correction needed at
  // all (unlike sin(), which clusters near its extremes — see the asin()
  // comment this replaced, in git history). Bonus: the sharp corner at each
  // peak reads as a crisp vein/crack line, closer to how real marble looks
  // than sin()'s smooth cloud-like transitions.
  float triWave(float x){
    return abs(fract(x) * 2.0 - 1.0);
  }

  void main(){
    // gl_FragCoord's origin is bottom-left with y increasing upward (WebGL/
    // OpenGL window-coordinate convention) — that already matches "+y = up",
    // which is what lightDir below assumes, so no flip needed here.
    vec2 uv = (gl_FragCoord.xy / uResolution.xy) * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    // Soft-edged circle (alpha falloff, not a hard discard) — an
    // anti-aliased edge reads as a polished glass ball; a discard-based
    // edge is visibly jagged on non-MSAA canvases.
    float edgeAlpha = 1.0 - smoothstep(0.92, 1.0, r2);
    if (edgeAlpha <= 0.0) { discard; }
    float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    vec3 normal = vec3(uv, z);

    // Slowly rotates the point sampled into the noise field, so the marble
    // pattern appears to flow/tumble across the sphere's surface over time
    // rather than sit as a static image.
    float t = uTime * uFlowSpeed;
    float ca = cos(t * 0.15), sa = sin(t * 0.15);
    mat3 rotY = mat3(ca,0.0,sa,  0.0,1.0,0.0,  -sa,0.0,ca);
    float cb = cos(t * 0.09), sb = sin(t * 0.09);
    mat3 rotX = mat3(1.0,0.0,0.0,  0.0,cb,-sb,  0.0,sb,cb);
    vec3 p = rotX * rotY * normal;

    // Marble formula: a wave warped by fbm turbulence — the classic
    // technique for veined/swirled marble, as opposed to plain noise (which
    // just looks like clouds, not marble). Lower frequency (1.4, down from
    // an even higher first pass) reads as a few bold, large ink-in-water
    // swirls like the reference, rather than busy fine-grained noise.
    // Triangle wave, not sin() — same phase input, converted from radians
    // to "cycles" (divide by 2*PI) since triWave's period is 1.0, not
    // 2*PI. Confirmed side-by-side against sin()+asin(): triangle wave
    // gives naturally uniform output with no correction step, and its
    // sharp-cornered peaks read as crisper marble veining.
    float n = fbm(p * 1.4 + vec3(0.0, 0.0, t * 0.25));
    float phase = ((p.x + p.y * 0.6) * 1.4 + n * 4.5) / 6.28318530718;
    float marble = triWave(phase);

    // Tiny dither breaks up the visible banding a smooth gradient mapped
    // through limited float precision otherwise shows as faint stepped rings.
    float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    // Plain 2-color mix — no black/white ramp. The 4-stop ramp (tried
    // first) baked a black shadow and white highlight into the color
    // function itself, but its equal-width bands meant a full third of
    // the sphere always trended toward white regardless of how dark the
    // configured colors were — the exact thing that kept reading as
    // "pale" through every round of color tuning. First-principles
    // simplification: just the two configured colors, nothing else,
    // mixed in linear space (see srgbToLinear above). The specular pass
    // below still provides a highlight/sheen — just as a small glossy
    // dot, not a third of the surface fading to white.
    vec3 colorFarLinear = srgbToLinear(uColorFar);
    vec3 colorNearLinear = srgbToLinear(uColorNear);
    vec3 base = mix(colorFarLinear, colorNearLinear, clamp(marble + dither, 0.0, 1.0));

    // Fake-sphere shading: one soft key light from the upper-left (matching
    // the reference), a soft glowing highlight (a wide+narrow specular pair,
    // not one hard dot — a single tight pow() reads as a sharp reflective
    // dot rather than a light source glowing through glass), and a dark
    // fresnel falloff toward the rim — what actually sells this as a
    // glossy solid ball instead of a flat painted circle.
    vec3 lightDir = normalize(vec3(-0.5, 0.6, 0.8));
    float diff = max(dot(normal, lightDir), 0.0);
    vec3 halfV = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    // Now the only source of a bright highlight — the old 4-stop ramp used
    // to fade a third of the surface to white on its own, so specular was
    // kept deliberately weak to avoid stacking on top of that. With the
    // ramp gone (plain 2-color mix above), base colors never reach white
    // by themselves, so specular is back up (0.3/0.1 -> 0.5/0.25) to
    // actually read as a glossy highlight rather than nothing.
    float specCore = pow(max(dot(normal, halfV), 0.0), 24.0);
    float specGlow = pow(max(dot(normal, halfV), 0.0), 5.0);
    float spec = specCore * 0.5 + specGlow * 0.25;
    float fresnel = pow(1.0 - z, 2.2);

    vec3 color = base * (0.45 + 0.55 * diff) * uBrightness;
    color += colorNearLinear * spec;
    // Glass-edge rim, two-stage: a deeper falloff toward near-black through
    // the mid rim (was 0.25/0.7 — too shallow to read as glass, closer to a
    // vignette), then a thin bright band right at the grazing edge catches
    // colorNear like a bezel of light — how a real glass sphere's rim
    // actually reads (grazing light either goes dark or catches a
    // highlight, not one flat gradient). Still only the two configured
    // colors — no white introduced.
    color = mix(color, colorFarLinear * 0.12, fresnel * 0.85);
    float rimBand = smoothstep(0.72, 0.95, fresnel) * (1.0 - smoothstep(0.95, 1.0, fresnel));
    color += colorNearLinear * rimBand * 0.85;

    // Explicit clamp before output — diffuse (~1.35x) + brightness (~1.35x)
    // + specular (+~0.75) stack on top of base, so bright overlapping
    // regions can still genuinely exceed 1.0 pre-clamp even without the
    // old ramp's white stop. Relying on the GPU/display to
    // clip that implicitly is exactly the kind of thing that can render
    // consistently on one machine and blow out to a much larger white area
    // on another (e.g. a wide-gamut/HDR-capable display handling
    // out-of-range values differently than a standard-range one) — clamp
    // it ourselves so the result doesn't depend on that.
    color = clamp(color, vec3(0.0), vec3(1.0));

    // Convert back to sRGB for display — everything above this line was
    // computed in linear space.
    gl_FragColor = vec4(linearToSrgb(color), edgeAlpha);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("AgentOrb shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * A flowing marbled glass sphere, rendered via a WebGL fragment shader —
 * fbm-warped simplex noise driving a sine-wave "marble" formula, with fake
 * sphere shading (key light + specular highlight + fresnel rim falloff) so
 * a flat circle reads as a glossy solid ball. The noise field slowly
 * rotates under the surface, which is what gives the "flowing" look,
 * rather than a static image or the sphere visibly spinning.
 *
 * Unlike the particle-cloud version this replaced, motion here is
 * continuous regardless of voice activity (a shader that only moves when
 * spoken to looks broken) — state (idle/listening/speaking) instead
 * nudges flow speed and brightness, smoothly lerped in JS so neither ever
 * jumps, rather than driving per-frame jitter off raw audio amplitude the
 * way individual particles used to. Only two colors (uColorFar/uColorNear,
 * from agent.config.json's orbTheme) drive the marble itself — a separate
 * accent-color layer was tried and dropped; it made the sphere read as a
 * fussy three-color composition instead of one confident gradient.
 *
 * Two independent inputs feed the same flow-speed/brightness response:
 * voice activity (glowRef, smoothed) and dragging the orb directly with a
 * pointer (stirRef, spikes on drag speed then decays like momentum). They
 * add together and clamp, so talking to it and grabbing it both make it
 * swirl harder rather than fighting each other.
 */
export const AgentOrb = ({ size = 64, state = "idle", audioLevelRef, micLevelRef, className = "", nearColor, farColor }) => {
  // Explicit colors (e.g. the orb-lab comparison page) always win. Absent
  // those, the palette rotates by day of week instead of sitting on one
  // fixed theme — computed once per mount so it can't drift mid-render if
  // this happens to straddle midnight.
  const dailyThemeRef = useRef(getDailyOrbTheme());
  const resolvedNear = nearColor ?? dailyThemeRef.current.near ?? ORB_THEME.nearColor;
  const resolvedFar  = farColor  ?? dailyThemeRef.current.far  ?? ORB_THEME.farColor;

  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const timeRef   = useRef(0);
  const glowRef   = useRef(0); // smoothed 0..1 "how lively right now" (audio-driven)
  const stirRef   = useRef(0); // 0..1+ "how lively right now" from dragging the orb itself
  const dragRef   = useRef({ active: false, x: 0, y: 0, t: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return; // WebGL unavailable — orb just doesn't render rather than crashing.

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("AgentOrb program link error:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // One oversized triangle covering the viewport — cheaper than two
    // triangles for a fullscreen quad, no shared-edge seam to worry about.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime       = gl.getUniformLocation(program, "uTime");
    const uFlowSpeed  = gl.getUniformLocation(program, "uFlowSpeed");
    const uColorFar   = gl.getUniformLocation(program, "uColorFar");
    const uColorNear  = gl.getUniformLocation(program, "uColorNear");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const [fr, fg, fb] = resolvedFar;
    const [nr, ng, nb] = resolvedNear;

    // Drag the orb and it stirs — pointer speed while held down feeds
    // straight into the same flow-speed/brightness response voice already
    // drives, so the two sources of "energy" behave identically instead of
    // one being a color trick and the other a physics trick. Capture the
    // pointer so dragging stays live even once the cursor leaves the
    // (fairly small) canvas bounds.
    const onPointerDown = (e) => {
      dragRef.current = { active: true, x: e.clientX, y: e.clientY, t: performance.now() };
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!dragRef.current.active) return;
      const now = performance.now();
      const dt = Math.max(now - dragRef.current.t, 1);
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const speed = Math.hypot(dx, dy) / dt; // px/ms
      stirRef.current = Math.min(2.2, stirRef.current + speed * 3.5);
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      dragRef.current.t = now;
    };
    const onPointerUp = () => { dragRef.current.active = false; };
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const draw = () => {
      timeRef.current += 0.016;
      const speaking  = state === "speaking";
      const listening = state === "listening";
      const level = speaking ? (audioLevelRef?.current ?? 0)
                  : listening ? (micLevelRef?.current ?? 0)
                  : 0;

      // Fast attack / slow release, same shape as the old balloon-radius
      // smoothing — reads as lively rather than a sudden snap in either
      // direction. Drives flow speed and brightness only now (no color
      // shift) — state is still legible, just via motion/light instead of
      // a third color competing with the two-color marble.
      const targetGlow = speaking || listening ? Math.min(1, 0.2 + level * 0.5) : 0;
      const growing = targetGlow > glowRef.current;
      glowRef.current += (targetGlow - glowRef.current) * (growing ? 0.35 : 0.06);
      const glow = glowRef.current;

      // Stir decays on its own each frame (no target to chase) — a flick
      // spikes it, then it settles back to 0 like real momentum bleeding off.
      stirRef.current *= 0.93;
      const stir = stirRef.current;
      const energy = Math.min(1.6, glow + stir);

      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, timeRef.current);
      gl.uniform1f(uFlowSpeed, 1.0 + energy * 0.9);
      gl.uniform3f(uColorFar, fr / 255, fg / 255, fb / 255);
      gl.uniform3f(uColorNear, nr / 255, ng / 255, nb / 255);
      gl.uniform1f(uBrightness, 1.0 + energy * 0.22);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [size, state, audioLevelRef, micLevelRef, resolvedNear, resolvedFar]);

  // Glow bleeds past the canvas into the page, colored with nearColor —
  // what actually reads as "premium" about the reference, versus a
  // hard-edged disc sitting flat on the background. Sized/blurred off the
  // orb's own size so it scales sensibly from the tiny launcher up to the
  // big /talk orb rather than needing per-usage tuning.
  const [glowR, glowG, glowB] = resolvedNear;
  const glowSize = size * 1.7;
  const glowInset = -(glowSize - size) / 2;

  return (
    <div className={`agent-orb-launcher relative ${className}`} style={{ width: size, height: size }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: glowInset,
          left: glowInset,
          width: glowSize,
          height: glowSize,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(${glowR}, ${glowG}, ${glowB}, 0.5) 0%, rgba(${glowR}, ${glowG}, ${glowB}, 0.18) 45%, rgba(${glowR}, ${glowG}, ${glowB}, 0) 72%)`,
          filter: `blur(${Math.max(8, size * 0.08)}px)`,
          pointerEvents: "none",
        }}
      />
      <canvas ref={canvasRef} className="agent-orb-canvas" style={{ display: "block", position: "relative" }} />
    </div>
  );
};
