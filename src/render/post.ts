// The full-screen pass from the prototype: ink outlines, radial blur and chromatic split with speed,
// speed lines when boosting, a slow-mo grade, an impact flash, vignette and grain. Feel, not skin
// (principle 1), so it's on in the greybox; the skin only picks the ink color.
//
// Outlines come from the depth buffer rather than inverted hulls, so instanced and merged meshes
// (traffic, city blocks, road chunks) get them with no extra draw calls. The edge test is the
// Laplacian of inverse depth: 1/z is linear across any plane in screen space, so flat faces come out
// zero at every distance, and only silhouettes and creases ink. Lines fade into the fog.

import { Color, DepthTexture, Matrix4, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';

export class PostPass {
  readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms = {
    tDiffuse: { value: null as unknown },
    tDepth: { value: null as unknown },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uImpact: { value: 0 },
    uSlow: { value: 0 },
    uAspect: { value: 1 },
    uTaps: { value: 10 },
    uNear: { value: 0.1 },
    uFar: { value: 3000 },
    uTexel: { value: [1, 1] },
    uInk: { value: new Color(0x120a20) },
    uOutline: { value: 1 },
    uFogNear: { value: 120 },
    uFogFar: { value: 900 },
    // Wet reflections: camera matrices, how wet the world is, what a ray that finds nothing sees.
    uProj: { value: new Matrix4() },
    uInvProj: { value: new Matrix4() },
    uView: { value: new Matrix4() },
    uWet: { value: 0 },
    /** 1 when the scene has standing water that mirrors in any weather. */
    uWater: { value: 0 },
    uSky: { value: new Color(0x3a4460) },
    uPixel: { value: [1, 1] },
    tInk: { value: null as unknown },
    tInkDepth: { value: null as unknown },
    uCarInk: { value: 0 },
  };

  constructor(width: number, height: number) {
    this.target = new WebGLRenderTarget(width, height, { samples: 4, type: HalfFloatType });
    this.target.depthTexture = new DepthTexture(width, height);
    this.uniforms.tDiffuse.value = this.target.texture;
    this.uniforms.tDepth.value = this.target.depthTexture;
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `uniform sampler2D tDiffuse,tDepth,tInk,tInkDepth;uniform float uCarInk;uniform float uTime,uSpeed,uBoost,uImpact,uSlow,uAspect,uNear,uFar,uOutline,uFogNear,uFogFar;
      uniform int uTaps;uniform vec2 uTexel,uPixel;uniform vec3 uInk,uSky;uniform mat4 uProj,uInvProj,uView;uniform float uWet,uWater;varying vec2 vUv;
      float hash(float n){return fract(sin(n)*43758.5453);}
      // Inverse view distance from the (perspective) depth buffer: linear across planes on screen.
      float invZ(vec2 uv){float d=texture2D(tDepth,uv).x;return (uFar-d*(uFar-uNear))/(uNear*uFar);}
      // Laplacian of 1/z at radius o, relative to the nearest sample, which also gives the depth
      // the line fades by. Both signs ink: silhouettes draw a band on each side (like an inverted
      // hull) and creases, where 1/z kinks, draw too.
      vec2 edgeAt(vec2 uv,vec2 o,float w){
        float a=invZ(uv+vec2(o.x,0.0)),b=invZ(uv-vec2(o.x,0.0)),c=invZ(uv+vec2(0.0,o.y)),d=invZ(uv-vec2(0.0,o.y));
        float near=max(max(max(a,b),max(c,d)),w);
        return vec2(abs(a+b+c+d-4.0*w)/near,near);
      }
      // The car ink pass (render/ink.ts): a part id in alpha and the view normal in rgb, trusted only
      // where its depth matches the scene's, so a car behind a building draws no lines on the building.
      vec4 carAt(vec2 uv){
        vec4 s=texture2D(tInk,uv);
        if(s.a<0.002)return vec4(0.0);
        float d=texture2D(tInkDepth,uv).x;
        float zi=(uFar-d*(uFar-uNear))/(uNear*uFar);
        float zs=invZ(uv);
        return abs(zi-zs)>zs*0.015?vec4(0.0):s;
      }
      float carInk(vec2 uv,vec2 o){
        vec4 c=carAt(uv);
        if(c.a==0.0)return 0.0;
        float id=floor(c.a*255.0+0.5);
        if(id>254.5)return 1.0;
        vec3 n=c.rgb*2.0-1.0;
        float e=0.0;
        vec2 offs[4];offs[0]=vec2(o.x,0.0);offs[1]=vec2(-o.x,0.0);offs[2]=vec2(0.0,o.y);offs[3]=vec2(0.0,-o.y);
        for(int k=0;k<4;k++){
          vec4 s=carAt(uv+offs[k]);
          if(s.a==0.0)continue;
          float j=floor(s.a*255.0+0.5);
          if(j>254.5)continue;
          if(abs(j-id)>0.5)e=1.0;
          else e=max(e,1.0-smoothstep(0.8,0.9,dot(n,s.rgb*2.0-1.0)));
        }
        float z=(uNear*uFar)/(uFar-texture2D(tInkDepth,uv).x*(uFar-uNear));
        return e*(1.0-smoothstep(28.0,80.0,z));
      }
      float ink(vec2 uv){
        float w=invZ(uv);
        vec2 e1=edgeAt(uv,uTexel,w);
        vec2 e2=edgeAt(uv,uTexel*0.5,w);
        float e=max(e1.x,e2.x*1.6);
        float z=1.0/max(e1.y,e2.y);
        float line=smoothstep(0.02,0.06,e)*(1.0-smoothstep(uFogNear*0.6,uFogFar*0.8,z));
        if(uCarInk>0.0)line=max(line,carInk(uv,uTexel*0.7)*uCarInk);
        return line;
      }
      // ---- wet reflections (screen space) ----
      vec3 viewPos(vec2 uv){vec4 p=uInvProj*vec4(uv*2.0-1.0,texture2D(tDepth,uv).x*2.0-1.0,1.0);return p.xyz/p.w;}
      // How much of this pixel is mirror: a wet sheen on every flat surface, near-mirror in a
      // puddle (puddles clear the alpha channel where they're drawn; everything else writes 1).
      // Returns the reflected color in rgb and the amount in a.
      vec4 reflection(vec2 uv){
        // Standing water (rivers) clears alpha too, and mirrors even when it's dry.
        // Additive draws (beams, glows) push alpha past 1 in the float target: clamp, or the mask
        // goes negative there and brightens instead of mirroring.
        float puddle=clamp(1.0-texture2D(tDiffuse,uv).a,0.0,1.0);
        if(uWet<=0.001&&puddle<0.02)return vec4(0.0);
        vec3 p0=viewPos(uv);
        if(-p0.z>uFar*0.5)return vec4(0.0);
        vec3 n=normalize(cross(viewPos(uv+vec2(uPixel.x,0.0))-p0,viewPos(uv+vec2(0.0,uPixel.y))-p0));
        if(dot(n,p0)>0.0)n=-n;
        vec3 upV=normalize((uView*vec4(0.0,1.0,0.0,0.0)).xyz);
        float flat_=smoothstep(0.9,0.97,dot(n,upV));
        if(flat_<=0.0)return vec4(0.0);
        float amount=flat_*max(uWet*mix(0.13,1.0,puddle),puddle*0.8);
        vec3 v=normalize(p0);
        vec3 r=reflect(v,n);
        float fres=0.35+0.65*pow(1.0-max(dot(-v,n),0.0),3.0);
        // March: steps grow with distance; refine the first hit by halving.
        float t=0.4,prev=0.0;vec2 hitUv=vec2(-1.0);
        for(int i=0;i<22;i++){
          vec3 q=p0+r*t;
          vec4 c=uProj*vec4(q,1.0);vec2 s=c.xy/c.w*0.5+0.5;
          if(s.x<0.0||s.x>1.0||s.y<0.0||s.y>1.0||c.w<0.0)break;
          float sz=viewPos(s).z;
          if(q.z<sz&&sz-q.z<max(0.6,t*0.35)){
            float a=prev,b=t;
            for(int k=0;k<4;k++){float m=(a+b)*0.5;vec3 qm=p0+r*m;vec4 cm=uProj*vec4(qm,1.0);vec2 sm=cm.xy/cm.w*0.5+0.5;if(qm.z<viewPos(sm).z)b=m;else a=m;}
            vec4 cb=uProj*vec4(p0+r*b,1.0);hitUv=cb.xy/cb.w*0.5+0.5;break;
          }
          prev=t;t*=1.3;
        }
        vec3 col=uSky;
        if(hitUv.x>=0.0){
          vec2 e=smoothstep(0.0,0.08,hitUv)*smoothstep(0.0,0.08,1.0-hitUv);
          // Wet asphalt smears reflections into vertical streaks; a puddle is a sharp mirror.
          float rough=(1.0-puddle)*0.035;
          vec3 h=vec3(0.0);
          for(int k=-2;k<=2;k++)h+=texture2D(tDiffuse,hitUv+vec2(0.0,float(k)*rough)).rgb;
          col=mix(uSky,h/5.0,e.x*e.y);
        }
        return vec4(col,amount*fres);
      }
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
        if(uWet>0.001||uWater>0.0){
          vec4 rf=reflection(vUv);
          // Wet surfaces darken, then mirror.
          col*=1.0-0.3*rf.a;
          col=mix(col,rf.rgb,clamp(rf.a,0.0,0.85));
        }
        if(uOutline>0.0)col=mix(col,uInk,ink(vUv)*uOutline);
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

  /** Size in device pixels; `lineScale` widens the ink on high-DPI screens. */
  setSize(width: number, height: number, lineScale = 1): void {
    this.target.setSize(width, height);
    this.uniforms.uAspect.value = width / height;
    this.uniforms.uTexel.value = [lineScale / width, lineScale / height];
    this.uniforms.uPixel.value = [1 / width, 1 / height];
  }

  render(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
