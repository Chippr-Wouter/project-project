import { useEffect, useRef } from "react"

export type BannerPrototypeSettings = {
  pixelSize: number
  strength: number
  color: number
  fade: number
  opacity: number
  overallOpacity: number
  height: number
  noise: number
  noiseScale: number
  zoom: number
  x: number
  y: number
}

const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`

const fragment = `#version 300 es
precision highp float;
uniform sampler2D photo;
uniform vec2 resolution;
uniform vec2 sourceSize;
uniform vec2 cropPosition;
uniform float zoom;
uniform float pixelSize;
uniform float strength;
uniform float colorAmount;
uniform float fadeDepth;
uniform float opacity;
uniform float noiseAmount;
uniform float noiseScale;
uniform int mode;
in vec2 uv;
out vec4 fragColor;
const int bayer8x8[64] = int[64](
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
);
float hash(float p) {
  return fract(sin(p * 127.1 + 311.7) * 43758.5453);
}
float noise(float p) {
  float cell = floor(p);
  float blend = fract(p);
  blend = blend * blend * (3.0 - 2.0 * blend);
  return mix(hash(cell), hash(cell + 1.0), blend);
}
vec4 sampleCrop(vec2 point) {
  float sourceAspect = sourceSize.x / sourceSize.y;
  vec2 crop = sourceAspect > 3.0
    ? vec2(3.0 / sourceAspect, 1.0)
    : vec2(1.0, sourceAspect / 3.0);
  crop /= zoom;
  float displayAspect = resolution.x / resolution.y;
  vec2 visible = displayAspect > 3.0
    ? vec2(1.0, 3.0 / displayAspect)
    : vec2(displayAspect / 3.0, 1.0);
  point = (point - 0.5) * visible + 0.5;
  return texture(photo, (1.0 - crop) * cropPosition + point * crop);
}
void main() {
  vec2 cell = floor(uv * resolution / pixelSize);
  ivec2 pos = ivec2(mod(cell, 8.0));
  float threshold = (float(bayer8x8[pos.y * 8 + pos.x]) + 0.5) / 64.0;
  vec2 snapped = (cell + 0.5) * pixelSize / resolution;
  vec4 original = sampleCrop(uv);
  if (mode == 2) {
    fragColor = original;
    return;
  }
  vec4 sampled = sampleCrop(mode == 0 ? snapped : uv);
  float luma = dot(sampled.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(vec3(luma), sampled.rgb, colorAmount);
  float horizontalNoise = noise(uv.x * noiseScale) * 0.7
    + noise(uv.x * noiseScale * 2.7 + 19.0) * 0.3;
  float fadeY = uv.y;
  if (mode == 1) {
    fadeY += (horizontalNoise - 0.5) * noiseAmount * sin(uv.y * 3.14159265);
  }
  float fade = 1.0 - smoothstep(1.0 - fadeDepth, 1.0, fadeY);
  float alpha = fade * opacity;
  if (mode == 0) {
    vec3 quantized = floor(color * 3.0 + threshold) / 3.0;
    color = mix(color, quantized, strength);
  } else {
    alpha = mix(alpha, step(threshold, alpha), strength);
  }
  fragColor = vec4(color, alpha * sampled.a);
}`

export function ProjectBannerPrototypeShader({
  image,
  settings,
  mode,
  label
}: {
  image: HTMLImageElement
  settings: BannerPrototypeSettings
  mode: "image" | "mask" | "original"
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const options = useRef({ settings, mode })

  useEffect(() => {
    options.current = { settings, mode }
    drawRef.current?.()
  }, [settings, mode])

  useEffect(() => {
    const canvas = ref.current!
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false })
    if (!gl) return () => {}
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed")
      }
      return shader
    }
    const program = gl.createProgram()
    const vs = compile(gl.VERTEX_SHADER, vertex)
    const fs = compile(gl.FRAGMENT_SHADER, fragment)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Shader link failed")
    }
    const activateProgram = gl.useProgram.bind(gl)
    activateProgram(program)
    const buffer = gl.createBuffer()
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, "position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    const uniform = (name: string) => gl.getUniformLocation(program, name)
    const uniforms = Object.fromEntries(
      [
        "resolution",
        "sourceSize",
        "cropPosition",
        "zoom",
        "pixelSize",
        "strength",
        "colorAmount",
        "fadeDepth",
        "opacity",
        "noiseAmount",
        "noiseScale",
        "mode"
      ].map((name) => [name, uniform(name)])
    )
    const draw = () => {
      const { settings: s, mode: currentMode } = options.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform2f(uniforms.sourceSize, image.naturalWidth, image.naturalHeight)
      gl.uniform2f(uniforms.cropPosition, s.x, s.y)
      gl.uniform1f(uniforms.zoom, s.zoom)
      gl.uniform1f(uniforms.pixelSize, s.pixelSize * dpr)
      gl.uniform1f(uniforms.strength, s.strength)
      gl.uniform1f(uniforms.colorAmount, s.color)
      gl.uniform1f(uniforms.fadeDepth, s.fade)
      gl.uniform1f(uniforms.opacity, s.opacity)
      gl.uniform1f(uniforms.noiseAmount, s.noise ?? 0.65)
      gl.uniform1f(uniforms.noiseScale, s.noiseScale ?? 5)
      gl.uniform1i(
        uniforms.mode,
        currentMode === "image" ? 0 : currentMode === "mask" ? 1 : 2
      )
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    drawRef.current = draw
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    draw()
    return () => {
      drawRef.current = null
      observer.disconnect()
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
    }
  }, [image])

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="block h-full w-full"
    />
  )
}
