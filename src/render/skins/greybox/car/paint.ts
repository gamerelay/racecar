// Car paint: the skin's three-step toon ramp plus what makes a finish read at a glance in a cel
// look. Gloss gets a small hard highlight, metallic a wide tinted one, pearl a hue shift at grazing
// angles, matte nothing, chrome a banded horizon reflection. A livery (stripes, a side flash, a
// band, rally blocks with number roundels) is painted in the shader from object-space position,
// so the body needs no UVs.

import { Color, type MeshToonMaterial, Vector2 } from 'three';
import type { PaintDef } from '../../../../core/content';
import { toon } from '../toon';

export type Livery = 'none' | 'stripes' | 'flash' | 'band' | 'rally';
const LIVERIES: Livery[] = ['none', 'stripes', 'flash', 'band', 'rally'];

const FINISH = { matte: 0, gloss: 1, metallic: 2, pearl: 3, chrome: 4 } as const;

/** `band`: the band livery's height range, for bodies that aren't car height. */
export function carPaint(paint: PaintDef, livery: Livery, band: [number, number] = [0.82, 1.0]): MeshToonMaterial {
  const chrome = paint.finish === 'chrome';
  const mat = toon({ color: chrome ? 0x8a8fa8 : paint.color });
  const uniforms = {
    uFinish: { value: FINISH[paint.finish] ?? 1 },
    // Rally numbers go on whatever the paint; the blocks need a second color.
    uLivery: { value: paint.secondary || livery === 'rally' ? LIVERIES.indexOf(livery) : 0 },
    uLiveryColor: { value: new Color(paint.secondary ?? paint.color) },
    uPaint: { value: new Color(paint.color) },
    uBand: { value: new Vector2(...band) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos=position;vObjN=normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjPos;varying vec3 vObjN;
        uniform int uFinish,uLivery;uniform vec3 uLiveryColor,uPaint;uniform vec2 uBand;
        float liveryMask(){
          vec3 p=vObjPos;vec3 n=normalize(vObjN);
          float side=step(0.7,abs(n.x));
          if(uLivery==1){
            // Twin stripes nose to tail, over every face but the sides.
            float s=step(abs(abs(p.x)-0.2),0.08);
            return s*(1.0-side);
          }
          if(uLivery==2){
            // A raked flash along each side, rising toward the tail.
            float y0=0.5-p.z*0.07;
            return side*step(y0,p.y)*step(p.y,y0+0.1+max(0.0,-p.z)*0.03);
          }
          if(uLivery==3){
            return side*step(uBand.x,p.y)*step(p.y,uBand.y);
          }
          if(uLivery==4){
            // Rally: a raked block over the back of each flank, a slash ahead of it, a hood stripe.
            float d=p.z*0.8-p.y;
            float flank=step(d,-1.25)+step(abs(d+0.95),0.07);
            float hood=step(0.8,n.y)*step(0.9,p.z)*step(abs(p.x),0.22);
            return min(1.0,side*flank+hood);
          }
          return 0.0;
        }
        // A seven-segment 7 in a (u, v) box of ±1.
        float seven(vec2 q){
          float t=0.2;
          float a=step(abs(q.y-0.85),t)*step(abs(q.x),0.62);
          // The stem: a stroke raked from the top right corner down to the bottom middle.
          vec2 s0=vec2(0.55,0.85);vec2 s1=vec2(-0.1,-0.95);
          vec2 e=s1-s0;float h=clamp(dot(q-s0,e)/dot(e,e),0.0,1.0);
          float b=step(length(q-s0-e*h),t);
          return max(a,b);
        }
        // Rally numbers: a white roundel on each door and a panel on the roof, each with a 7.
        vec3 rallyNumbers(vec3 c){
          vec3 p=vObjPos;vec3 n=normalize(vObjN);
          vec3 ink=vec3(0.086,0.07,0.12);
          if(abs(n.x)>0.7){
            vec2 q=vec2(-sign(p.x)*(p.z-0.25),p.y-0.7)/0.22;
            float r=length(q);
            if(r<1.0)c=mix(vec3(0.96,0.95,1.0),ink,max(step(0.88,r),seven(q*1.45)));
          }else if(n.y>0.85&&p.y>1.3){
            vec2 q=vec2(-p.x,p.z+0.85)/vec2(0.3,0.42);
            if(max(abs(q.x),abs(q.y))<1.0)c=mix(vec3(0.96,0.95,1.0),ink,seven(q*vec2(1.25,1.2)));
          }
          return c;
        }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,uLiveryColor,liveryMask());\nif(uLivery==4)diffuseColor.rgb=rallyNumbers(diffuseColor.rgb);')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V=normalize(vViewPosition);
          vec3 N=normalize(normal);
          vec3 L=normalize(vec3(-0.3,0.75,0.55));
          #if NUM_DIR_LIGHTS > 0
            L=normalize(directionalLights[0].direction+vec3(0.0,0.6,0.0));
          #endif
          float s=max(dot(N,normalize(L+V)),0.0);
          float fres=1.0-max(dot(N,V),0.0);
          vec3 base=diffuseColor.rgb;
          if(uFinish==1){
            outgoingLight+=mix(base,vec3(1.0),0.7)*step(0.985,s)*0.5;
            outgoingLight+=base*step(0.75,fres)*0.25;
          }else if(uFinish==2){
            outgoingLight+=mix(vec3(1.0),base*1.5,0.5)*step(0.93,s)*0.55;
            outgoingLight+=vec3(1.0)*step(0.99,s)*0.5;
            outgoingLight+=base*step(0.7,fres)*0.3;
          }else if(uFinish==3){
            vec3 shift=vec3(base.g,base.b,base.r);
            outgoingLight=mix(outgoingLight,mix(base,shift,0.6)*0.8+0.1,step(0.7,fres)*0.35);
            outgoingLight+=vec3(1.0)*step(0.975,s)*0.6;
          }else if(uFinish==4){
            // Toon chrome: sky above the reflected horizon, a hot band on it, dark ground below.
            vec3 r=inverseTransformDirection(reflect(-V,N),viewMatrix);
            vec3 sky=mix(vec3(0.95,0.8,1.0),vec3(0.55,0.62,0.95),step(0.35,r.y));
            vec3 ground=vec3(0.13,0.09,0.2);
            vec3 c=mix(ground,sky,step(0.0,r.y));
            c=mix(c,vec3(1.0,0.93,0.8),step(abs(r.y-0.03),0.05));
            outgoingLight=mix(c,uLiveryColor,step(0.5,liveryMask()))*(0.55+0.45*outgoingLight/max(base,vec3(0.05)));
            outgoingLight+=vec3(1.0)*step(0.99,s)*0.6;
          }else{
            outgoingLight+=base*step(0.8,fres)*0.12;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'car-paint';
  return mat;
}
