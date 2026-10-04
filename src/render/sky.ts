import * as THREE from 'three';

/**
 * 天空球：天頂到地平線的漸層＋太陽光暈。跟著鏡頭移動，不受地平線下彎影響（自訂 shader）。
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4aa3e8) },
        uHorizon: { value: new THREE.Color(0xd9f0ff) },
        uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() },
        uSunColor: { value: new THREE.Color(0xfff2d0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          vec4 p = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w; // 永遠畫在最遠處
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vDir;
        void main() {
          float h = clamp( vDir.y, -0.2, 1.0 );
          // 地平線附近亮、往上漸深（指數曲線比線性更像真的天空）
          float t = pow( max( h, 0.0 ), 0.55 );
          vec3 col = mix( uHorizon, uTop, t );
          // 地平線以下略暗（被地形擋住的部分）
          col *= 1.0 - 0.25 * clamp( -h * 4.0, 0.0, 1.0 );
          // 太陽光暈
          float s = max( dot( normalize( vDir ), normalize( uSunDir ) ), 0.0 );
          col += uSunColor * ( pow( s, 400.0 ) * 1.2 + pow( s, 12.0 ) * 0.18 );
          gl_FragColor = vec4( col, 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  /** 設定天空顏色與太陽方向 */
  set(top: THREE.ColorRepresentation, horizon: THREE.ColorRepresentation, sunDir: THREE.Vector3, sunColor: THREE.ColorRepresentation): void {
    (this.mat.uniforms.uTop.value as THREE.Color).set(top);
    (this.mat.uniforms.uHorizon.value as THREE.Color).set(horizon);
    (this.mat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
    (this.mat.uniforms.uSunColor.value as THREE.Color).set(sunColor);
  }

  /** 跟著鏡頭移動（天空永遠以鏡頭為中心） */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
