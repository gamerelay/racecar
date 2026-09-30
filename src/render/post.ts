// The full-screen feel pass from the prototype: radial blur and chromatic split with speed, speed
// lines when boosting, a slow-mo grade, an impact flash, vignette and grain. Feel, not skin
// (principle 1), so it's on in the greybox.

import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer, HalfFloatType } from 'three';

export class PostPass {
  readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms = {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uImpact: { value: 0 },
    uSlow: { value: 0 },
    uAspect: { value: 1 },
    uTaps: { value: 10 },
  };

  constructor(width: number, height: number) {
    this.target = new WebGLRenderTarget(width, height, { samples: 4, type: HalfFloatType });
    this.uniforms.tDiffuse.value = this.target.texture;
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,uSpeed,uBoost,uImpact,uSlow,uAspect;uniform int uTaps;varying vec2 vUv;
      float hash(float n){return fract(sin(n)*43758.5453);}
      void main(){
        vec2 c=vUv-0.5;float len=length(c*vec2(uAspect,1.0));
        float edge=smoothstep(0.08,0.6,len);
        float blur=(0.012*uSpeed+0.05*uBoost+0.03*uImpact)*edge;
        float ca=0.0012+0.005*uBoost+0.012*uImpact;
        vec3 col=vec3(0.0);
        float n=0.0;
        for(int i=0;i<12;i++){
          if(i>=uTaps)break;
          float s=1.0-blur*float(i)/float(uTaps);
          col.r+=texture2D(tDiffuse,0.5+c*s*(1.0+ca)).r;
          col.g+=texture2D(tDiffuse,0.5+c*s).g;
          col.b+=texture2D(tDiffuse,0.5+c*s*(1.0-ca)).b;
          n+=1.0;
        }
        col/=n;
        float ang=atan(c.y,c.x*uAspect);
        float id=floor(ang*52.0/3.14159);float h=hash(id);
        float streak=step(0.7,h)*smoothstep(0.32,0.75,len)*step(0.62,fract(len*2.2-uTime*(3.0+h*4.0)+h*7.0));
        col=mix(col,vec3(1.0,0.96,0.86),streak*uBoost*0.5);
        float g=dot(col,vec3(0.299,0.587,0.114));
        col=mix(col,vec3(g)*vec3(1.08,0.92,1.25),uSlow*0.6);
        col+=uImpact*vec3(1.0,0.72,0.5)*0.3;
        col*=1.0-smoothstep(0.45,1.05,len)*(0.5+0.25*uBoost);
        col+=(hash(dot(vUv,vec2(12.9898,78.233))*917.0+fract(uTime)*31.0)-0.5)*0.03;
        gl_FragColor=vec4(col,1.0);
        #include <colorspace_fragment>
      }`,
    });
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), mat));
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.uniforms.uAspect.value = width / height;
  }

  render(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
