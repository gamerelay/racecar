// The poster shots: each stages a moment on a real track and frames it. See poster.ts for the URL.
//
// Time runs up to t = 0, the frozen moment. Poses come from Stage.drive (along the road) and
// Stage.tumble (ballistic after a hit); wrecks fire at their own time and run on from there.

import { cam, knob, offset, Stage, type Shot } from './poster-stage';

const q = (name: string, value: string) => new URLSearchParams(location.search).get(name) ?? value;

/** The Boulevard hero: a pink Vanta boosting at the camera, a van cartwheeling behind it. */
function boulevard(s = knob('s', 318)): Stage {
  const st = new Stage('downtown/downtown');
  st.car('coupe', 'pink', { pose: st.drive(s, -2, 52), speed: 52, boost: true });
  // A rival, boosting too, a length back.
  st.car('muscle', 'sunburst', { pose: st.drive(s - 24, 9, 50), speed: 50, boost: true });
  // The van it just took out: cartwheeling.
  const van = st.drive(s - knob('vs', 16), knob('vl', 1.3), 19);
  const tw = -knob('vt', 0.42);
  st.car('van', 1, { pose: st.tumble(van, tw, { up: knob('vu', 13), right: -2 }, [knob('wp', 1.2), knob('wy', -1.5), knob('wr', -4)]), speed: 19, wreck: { t: tw, dx: 0.9, dz: -0.4, strength: 1, sparks: 2 } });
  // Traffic.
  st.car('sedan', 0, { pose: st.drive(s - 50, -6, 18), speed: 18 });
  st.car('compact', 2, { pose: st.drive(s - 72, 5, 18), speed: 18 });
  st.car('bus', 3, { pose: st.drive(s - 100, -6, 16), speed: 16 });
  return st;
}

/** The Skyway at sunset: a pink Vanta boosting away, the rival it just took down cartwheeling over the sun. */
function skyway(s = knob('s', 1165)): Stage {
  const st = new Stage('downtown/downtown');
  st.car('coupe', 'pink', { pose: st.drive(s, knob('hl', -1.5), 54), speed: 54, boost: true });
  const rival = st.drive(s + knob('rs', 25), knob('rl', -4), 44);
  const tw = -knob('rt', 0.55);
  st.car(q('rc', 'muscle'), q('rp', 'violet'), {
    pose: st.tumble(rival, tw, { up: knob('ru', 15), right: knob('rr', 2.5) }, [knob('wp', -1.5), knob('wy', 0.9), knob('wr', 6)]),
    speed: 44,
    boost: (t) => t < tw,
    wreck: { t: tw, dx: -1, dz: -0.3, strength: 1, sparks: knob('sp', 1) },
  });
  // Another rival coming up, and traffic ahead.
  st.car('rally', 'sunburst', { pose: st.drive(s + knob('xs', 10), knob('xl', 6), 52), speed: 52, boost: true });
  st.car('sedan', 0, { pose: st.drive(s + 45, -3.5, 19), speed: 19 });
  st.car('bus', 5, { pose: st.drive(s + 80, 3.5, 17), speed: 17 });
  st.car('compact', 1, { pose: st.drive(s + 120, -3.5, 18), speed: 18 });
  return st;
}

/** Which way the road turns at s: +1 left, -1 right (heading increases to the left). */
function turn(st: Stage, s: number, spline = 0): number {
  const d = st.at(s + 6, 0, spline).h - st.at(s - 6, 0, spline).h;
  return Math.sign(Math.atan2(Math.sin(d), Math.cos(d))) || 1;
}

export const SHOTS: Shot[] = [
  {
    name: 'og',
    w: 1200,
    h: 630,
    title: { x: 0.045, y: 0.235, size: 0.165, tagline: 'DRIFT · BOOST · WRECK' },
    build() {
      const stage = boulevard();
      const p = stage.at(knob('s', 318), -2);
      const camera = cam(knob('fov', 34), offset(p, knob('cr', 2.9), knob('cu', 0.45), knob('cf', 7.2)), offset(p, knob('lr', 0.2), knob('lu', 1.7), knob('lf', -10)));
      stage.run(-1.2, 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'cover-1920x1080',
    w: 1920,
    h: 1080,
    title: { x: 0.05, y: 0.2, size: 0.13, tagline: 'ARCADE RACING · TAKEDOWNS · TRAFFIC' },
    build() {
      const stage = skyway();
      const p = stage.at(knob('s', 1165), knob('hl', -1.5));
      const camera = cam(knob('fov', 36), offset(p, knob('cr', -2.6), knob('cu', 1.9), knob('cf', -9)), offset(p, knob('lr', 0.8), knob('lu', 3), knob('lf', 30)));
      stage.run(-1.2, 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'cover-1080x1350',
    w: 1080,
    h: 1350,
    title: { x: 0.5, y: 0.14, size: 0.085, align: 'center', tagline: 'ARCADE RACING · TAKEDOWNS' },
    build() {
      const stage = skyway();
      const p = stage.at(knob('s', 1165), knob('hl', -1.5));
      const camera = cam(knob('fov', 52), offset(p, knob('cr', -0.6), knob('cu', 1.8), knob('cf', -8.5)), offset(p, knob('lr', -2.2), knob('lu', 5), knob('lf', 30)));
      stage.run(-1.2, 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'lineup-1080x1080',
    w: 1080,
    h: 1080,
    title: { x: 0.5, y: 0.13, size: 0.1, align: 'center', tagline: 'PICK YOUR RIDE · WRECK THE REST' },
    build() {
      const stage = new Stage('downtown/downtown');
      const s0 = knob('s', 40);
      // Three rows on the grid, noses to the camera: racers in front, the big ones at the back.
      const cars: [string, string, number, number][] = [
        ['coupe', 'pink', 0, 1.2],
        ['muscle', 'sunburst', -3.6, 0],
        ['rally', 'lime', 3.6, 0],
        ['hatch', 'cyan', -5.6, -6.2],
        ['police', 'snow', -1.9, -6.8],
        ['sedan', 'violet', 1.9, -6.8],
        ['van', 'ember', 5.6, -6.4],
        ['compact', 'snow', -6.2, -13.5],
        ['truck', 'chrome', -1.2, -15],
        ['bus', 'midnight', 4.6, -17.5],
      ];
      const yaw = knob('yaw', -0.35);
      for (const [id, paint, lat, back] of cars) stage.car(id, paint, { pose: stage.drive(s0 + back * knob('sb', 1.2), lat * knob('sl', 1.2), 0, { yaw }) });
      const p = stage.at(s0, 0);
      const camera = cam(knob('fov', 43), offset(p, knob('cr', -1.2), knob('cu', 3.8), knob('cf', 15.5)), offset(p, knob('lr', 1), knob('lu', 1.4), knob('lf', -9)));
      stage.run(0, 0.1, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'drift-1920x1080',
    w: 1920,
    h: 1080,
    build() {
      // Downtown, the Boulevard's end: a Brute sliding the right-hander at full lock, a Mudlark on its bumper.
      const stage = new Stage('downtown/downtown');
      const s0 = knob('s', 440);
      const dir = turn(stage, s0);
      const yaw = dir * knob('yaw', 0.85);
      stage.car('muscle', 'sunburst', { pose: stage.drive(s0, knob('hl', 0), 30, { yaw }), speed: 30, drift: 3, steer: -dir });
      stage.car('rally', 'lime', { pose: stage.drive(s0 - knob('gap', 10), knob('rl', -1), 30, { yaw: yaw * 0.9 }), speed: 30, drift: 2, steer: -dir });
      const p = stage.at(s0, 0);
      const camera = cam(knob('fov', 40), offset(p, knob('cr', 11), knob('cu', 12), knob('cf', 6)), offset(p, knob('lr', 0), knob('lu', 0), knob('lf', -6)));
      stage.run(-knob('run', 3), 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'takedown-bus-1920x1080',
    w: 1920,
    h: 1080,
    build() {
      // Downtown: a Zip shoved into the side of a Route 88, bouncing off it in pieces, the Vanta boosting through.
      const stage = new Stage('downtown/downtown');
      const s0 = knob('s', 150);
      const bus = stage.drive(s0, knob('bl', 4), 14);
      const tw = -knob('tw', 0.3);
      stage.car('bus', 'sunburst', { pose: bus, speed: 14, wreck: { t: tw, dx: -1, dz: 0.1, strength: 1, sparks: 1.5 } });
      const hatch = stage.drive(s0 + knob('hs', 1.5), knob('hl', 0.4), 38, { yaw: knob('hy', -0.9) });
      stage.car('hatch', 'cyan', { pose: stage.tumble(hatch, tw, { up: knob('hu', 9), right: -6, fwd: -8 }, [knob('wp', -2.5), knob('wy', 2), knob('wr', 3.5)]), speed: 38, wreck: { t: tw, dx: 0.4, dz: 1, strength: 1, sparks: 1.5 } });
      stage.car('coupe', 'pink', { pose: stage.drive(s0 - knob('cs', 6), knob('cl', -4.5), 50), speed: 50, boost: true });
      stage.car('sedan', 1, { pose: stage.drive(s0 - 40, -8, 16), speed: 16 });
      stage.car('compact', 4, { pose: stage.drive(s0 + 40, 8, 17), speed: 17 });
      const p = stage.at(s0, 0);
      const camera = cam(knob('fov', 40), offset(p, knob('cr', -3), knob('cu', 0.8), knob('cf', 15)), offset(p, knob('lr', 1.5), knob('lu', 2.4), knob('lf', 0)));
      stage.run(-1.2, 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'police-night-1920x1080',
    w: 1920,
    h: 1080,
    build() {
      // Downtown at midnight, the Underpass: the Interceptor, lights going, on a Brute's tail.
      const stage = new Stage('downtown/downtown', 'midnight');
      stage.wet = knob('wet', 0.6);
      const s0 = knob('s', 2860);
      stage.car('muscle', 'violet', { pose: stage.drive(s0, knob('hl', 1), 46), speed: 46, boost: true });
      stage.car('police', 'snow', { pose: stage.drive(s0 - knob('ps', 9), knob('pl', 3.5), 46), speed: 46 });
      const p = stage.at(s0, 0);
      const camera = cam(knob('fov', 36), offset(p, knob('cr', 3), knob('cu', 0.8), knob('cf', 8)), offset(p, knob('lr', 0), knob('lu', 1.1), knob('lf', -9)));
      stage.run(-knob('run', 1.02), 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
  {
    name: 'leap-1920x1080',
    w: 1920,
    h: 1080,
    build() {
      // Backroads, Logger's Leap: a Mudlark off the edge into the sunset, another lining up behind.
      const stage = new Stage('backroads/valley');
      const spline = knob('sp', 2);
      const s0 = knob('s', 62);
      const base = stage.drive(s0, 0, 34, { spline });
      const lift = knob('lift', 3.5);
      const air = (t: number) => {
        const p = base(t);
        p.y += lift;
        p.pitch = knob('pitch', -0.12);
        p.roll = knob('roll', 0.08);
        return p;
      };
      stage.car('rally', 'lime', { pose: air, speed: 34, air: () => true, boost: true });
      stage.car('hatch', 'pink', { pose: stage.drive(s0 - knob('gap', 16), knob('gl', 2), 34, { spline }), speed: 34, dust: true });
      const p = stage.at(s0, 0, spline);
      const camera = cam(knob('fov', 32), offset(p, knob('cr', -6), knob('cu', 2.5), knob('cf', 11)), offset(p, knob('lr', 0), knob('lu', 3), knob('lf', -2)));
      stage.run(-0.8, 0, camera.position);
      return { stage, camera, look: { line: 2 } };
    },
  },
];
