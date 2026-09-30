// Car paint: the skin's three-step toon ramp plus what makes a finish read at a glance in a cel
// look. Gloss gets a small hard highlight, metallic a wide tinted one, pearl a hue shift at grazing
// angles, matte nothing, chrome a banded horizon reflection. A livery (stripes, a side flash, a
// band, rally blocks with number roundels, a police black-and-white) is painted in the shader from object-space position,
// so the body needs no UVs.

import { Color, type MeshToonMaterial, Vector2 } from 'three';
import type { PaintDef } from '../../../../core/content';
import { toon } from '../toon';

export type Livery = 'none' | 'stripes' | 'flash' | 'band' | 'rally' | 'police';
const LIVERIES: Livery[] = ['none', 'stripes', 'flash', 'band', 'rally', 'police'];

const FINISH = { matte: 0, gloss: 1, metallic: 2, pearl: 3, chrome: 4 } as const;

/** Seven-segment masks (bits a–g), 0–9: the rally number's digit. */
const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** The door number for a paint: 1–9 from its id, so each paint keeps its own. */
export function rallyNumber(paint: PaintDef): number {
  let h = 7;
  for (const ch of paint.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1 + (h % 9);
}

/**
 * `band`: the band livery's height range, for bodies that aren't car height. `glint`: glass, with a
 * banded sky reflection and the highlight as diagonal streaks, so a flat pane never lights up whole.
 */
export function carPaint(paint: PaintDef, livery: Livery, band: [number, number] = [0.82, 1.0], glint = false): MeshToonMaterial {
  const chrome = paint.finish === 'chrome';
  const mat = toon({ color: chrome ? 0x8a8fa8 : paint.color });
  // A band with no second color still shows: a light band on a dark paint, a dark one on a light paint.
  const base = new Color(paint.color);
  const second = paint.secondary ? new Color(paint.secondary) : base.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45 ? base.clone().lerp(new Color(0x16121f), 0.7) : base.clone().lerp(new Color(0xf5f1ff), 0.75);
  const uniforms = {
    uFinish: { value: FINISH[paint.finish] ?? 1 },
    // Rally numbers, police colors and bands go on whatever the paint; stripes and flashes need a second color.
    uLivery: { value: paint.secondary || livery === 'rally' || livery === 'police' || livery === 'band' ? LIVERIES.indexOf(livery) : 0 },
    uLiveryColor: { value: second },
    uPaint: { value: base },
    uBand: { value: new Vector2(...band) },
    uDigit: { value: DIGITS[rallyNumber(paint)] },
    uGlint: { value: glint ? 1 : 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;varying vec3 vObjN;varying vec3 vBentN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObjPos=position;vObjN=normal;
        // The highlight's normal, bowed a little with position: a flat panel shades as if gently
        // curved, so the glint lands on part of it instead of lighting the whole face at once.
        vec3 bent=normal+position*vec3(0.1,0.14,0.06);
        #ifdef USE_INSTANCING
          bent=mat3(instanceMatrix)*bent;
        #endif
        vBentN=normalize(normalMatrix*bent);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjPos;varying vec3 vObjN;varying vec3 vBentN;
        uniform int uFinish,uLivery,uDigit;uniform float uGlint;uniform vec3 uLiveryColor,uPaint;uniform vec2 uBand;
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
        // Police: always black and white, whatever the paint (only the finish shows through). White
        // front and rear doors (the sedan's cuts at z 1.05 and −1.3) and roof, with a block of dark
        // "lettering" along the doors: six cells read as a word at racing speed.
        vec3 police(){
          vec3 p=vObjPos;vec3 n=normalize(vObjN);
          vec3 dark=vec3(0.07,0.07,0.11);vec3 white=vec3(0.95,0.95,1.0);
          if(abs(n.x)>0.7&&p.z<1.05&&p.z>-1.3){
            float z=0.82-p.z;float cell=fract(z/0.3);
            float word=step(0.0,z)*step(z,1.8)*step(0.14,cell)*step(abs(p.y-0.58),0.07);
            return mix(white,dark,word);
          }
          if(n.y>0.85&&p.y>1.2)return white;
          return dark;
        }
        // A seven-segment digit (uDigit's bits a–g) in a (u, v) box of ±1, raked like a race number.
        float bar(vec2 q,vec2 c,vec2 h){vec2 d=abs(q-c)-h;return step(max(d.x,d.y),0.0);}
        float digit(vec2 q){
          q.x-=q.y*0.18;
          float t=0.17;float w=0.5;float v=0.42;
          float m=0.0;
          if((uDigit&1)!=0)m=max(m,bar(q,vec2(0.0,0.84),vec2(w,t)));
          if((uDigit&2)!=0)m=max(m,bar(q,vec2(w,v),vec2(t,v)));
          if((uDigit&4)!=0)m=max(m,bar(q,vec2(w,-v),vec2(t,v)));
          if((uDigit&8)!=0)m=max(m,bar(q,vec2(0.0,-0.84),vec2(w,t)));
          if((uDigit&16)!=0)m=max(m,bar(q,vec2(-w,-v),vec2(t,v)));
          if((uDigit&32)!=0)m=max(m,bar(q,vec2(-w,v),vec2(t,v)));
          if((uDigit&64)!=0)m=max(m,bar(q,vec2(0.0,0.0),vec2(w,t)));
          return m;
        }
        // Rally numbers: a white roundel on each door and a panel on the roof, each with the paint's digit.
        vec3 rallyNumbers(vec3 c){
          vec3 p=vObjPos;vec3 n=normalize(vObjN);
          vec3 ink=vec3(0.086,0.07,0.12);
          if(abs(n.x)>0.7){
            vec2 q=vec2(-sign(p.x)*(p.z-0.25),p.y-0.7)/0.22;
            float r=length(q);
            if(r<1.0)c=mix(vec3(0.96,0.95,1.0),ink,max(step(0.88,r),digit(q*1.45)));
          }else if(n.y>0.85&&p.y>1.3){
            vec2 q=vec2(-p.x,p.z+0.85)/vec2(0.3,0.42);
            if(max(abs(q.x),abs(q.y))<1.0)c=mix(vec3(0.96,0.95,1.0),ink,digit(q*vec2(1.25,1.2)));
          }
          return c;
        }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,uLiveryColor,liveryMask());\nif(uLivery==4)diffuseColor.rgb=rallyNumbers(diffuseColor.rgb);\nif(uLivery==5)diffuseColor.rgb=police();')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V=normalize(vViewPosition);
          vec3 N=normalize(gl_FrontFacing?vBentN:-vBentN);
          vec3 L=normalize(vec3(-0.3,0.75,0.55));
          #if NUM_DIR_LIGHTS > 0
            L=normalize(directionalLights[0].direction+vec3(0.0,0.6,0.0));
          #endif
          float s=max(dot(N,normalize(L+V)),0.0);
          float fres=1.0-max(dot(N,V),0.0);
          vec3 base=diffuseColor.rgb;
          if(uGlint>0.0){
            // Glass: toon chrome, darker and tinted: dark ground below the reflected horizon, a pale
            // glass-blue sky over it fading to deep blue overhead, a hot streak on the horizon, and a
            // lift at grazing angles. Where it faces the light, a raked glint (a wide streak and a thin
            // one) instead of one flat block.
            vec3 r=inverseTransformDirection(reflect(-V,N),viewMatrix);
            // Bands spaced for raked glass too, whose reflections mostly look up into the sky.
            vec3 sky=mix(base*1.9+vec3(0.08,0.1,0.18),base*1.4+vec3(0.02,0.03,0.08),step(0.28,r.y));
            sky=mix(sky,base*1.05,step(0.58,r.y));
            vec3 c=mix(base*0.4,sky,step(0.0,r.y));
            c=mix(c,vec3(0.82,0.88,1.0),step(abs(r.y-0.13),0.035)*0.85);
            c+=vec3(0.18,0.22,0.36)*step(0.65,fres);
            outgoingLight=c*(0.7+0.3*outgoingLight/max(base,vec3(0.05)));
            float q=fract((vObjPos.x*0.7+vObjPos.y*1.1+vObjPos.z*0.25)*1.3);
            float streak=step(q,0.2)+step(abs(q-0.33),0.035);
            outgoingLight+=vec3(0.9,0.93,1.0)*step(0.94,s)*streak*0.3;
          }else if(uFinish==1){
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
