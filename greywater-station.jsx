import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   GREYWATER STATION — a night-shift horror
   Mechanics:
   - SOUND: loud choices raise it. The thing in the pipes hunts
     by sound. Cross the thresholds and routes change under you.
   - WORDS: it learns your voice from what you give it. Every
     word you speak aloud, it keeps. The ending remembers.
   Replayable: multiple deaths, three survivals, tracked per session.
   ============================================================ */

const ITEM_NAMES = {
  cutters: "Bolt cutters",
  keyring: "Brass keyring",
};

/* ============================================================
   DREAD AUDIO — fully synthesized with the Web Audio API.
   No audio files. Every drip, drone, whisper and heartbeat
   is generated live. Master gain gates the mute toggle.
   ============================================================ */
class DreadAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.brownBuf = null;
    this.whiteBuf = null;
    this.ambNodes = [];
    this.ambTimers = [];
    this.scene = null;
    this.enabled = true;
    this.heartTimer = null;
  }

  ensure() {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      this.master.connect(this.ctx.destination);
      this.brownBuf = this.makeBuf("brown");
      this.whiteBuf = this.makeBuf("white");
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  makeBuf(kind) {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      } else {
        d[i] = w * 0.6;
      }
    }
    return buf;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(
        on ? 0.55 : 0,
        this.ctx.currentTime + 0.25
      );
    }
  }

  clearAmb() {
    this.ambTimers.forEach((t) => clearTimeout(t));
    this.ambTimers = [];
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ambNodes.forEach(({ src, gain }) => {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + 1.1);
        if (src && src.stop) src.stop(t + 1.3);
      } catch (e) {
        /* node already stopped */
      }
    });
    this.ambNodes = [];
  }

  layer(build, vol) {
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);
    const src = build(g);
    g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 2.2);
    this.ambNodes.push({ src, gain: g });
    return g;
  }

  /* ---- ambience layers ---- */
  hum(freq, vol) {
    // dying fluorescent tube
    this.layer((g) => {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = freq * 4;
      o.connect(lp);
      lp.connect(g);
      o.start();
      return o;
    }, vol);
  }

  crackle() {
    // random electrical spits from the bad tube
    const fire = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const s = this.ctx.createBufferSource();
      s.buffer = this.whiteBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.02 + Math.random() * 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 + Math.random() * 0.08);
      s.connect(hp);
      hp.connect(g);
      g.connect(this.master);
      s.start(t);
      s.stop(t + 0.15);
      this.ambTimers.push(setTimeout(fire, 250 + Math.random() * 2600));
    };
    this.ambTimers.push(setTimeout(fire, 400));
  }

  roomtone(vol) {
    this.layer((g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.brownBuf;
      s.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
      s.connect(lp);
      lp.connect(g);
      s.start();
      return s;
    }, vol);
  }

  drips(min, max, vol) {
    const fall = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      const f0 = 700 + Math.random() * 900;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.3, t + 0.11);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      o.connect(g);
      if (pan) {
        pan.pan.value = Math.random() * 1.6 - 0.8;
        g.connect(pan);
        pan.connect(this.master);
      } else {
        g.connect(this.master);
      }
      o.start(t);
      o.stop(t + 0.35);
      this.ambTimers.push(setTimeout(fall, min + Math.random() * (max - min)));
    };
    this.ambTimers.push(setTimeout(fall, 700));
  }

  drone(vol) {
    // pump-hall cathedral: two detuned lows beating against each other
    this.layer((g) => {
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = o2.type = "sine";
      o1.frequency.value = 52;
      o2.frequency.value = 52.7;
      o1.connect(g);
      o2.connect(g);
      o1.start();
      o2.start();
      this.ambNodes.push({ src: o2, gain: g });
      return o1;
    }, vol);
  }

  groans() {
    // distant settling metal
    const groan = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(46 + Math.random() * 14, t);
      o.frequency.linearRampToValueAtTime(34, t + 2.6);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.1);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.8);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 3);
      this.ambTimers.push(setTimeout(groan, 12000 + Math.random() * 16000));
    };
    this.ambTimers.push(setTimeout(groan, 6000 + Math.random() * 8000));
  }

  water(vol) {
    // black water, slowly breathing
    this.layer((g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.brownBuf;
      s.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 240;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lg = this.ctx.createGain();
      lg.gain.value = vol * 0.45;
      lfo.connect(lg);
      lg.connect(g.gain);
      s.connect(lp);
      lp.connect(g);
      s.start();
      lfo.start();
      this.ambNodes.push({ src: lfo, gain: g });
      return s;
    }, vol);
  }

  wind(vol) {
    // the shaft: hollow moving air
    this.layer((g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.whiteBuf;
      s.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 520;
      bp.Q.value = 1.4;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.14;
      const lg = this.ctx.createGain();
      lg.gain.value = 260;
      lfo.connect(lg);
      lg.connect(bp.frequency);
      s.connect(bp);
      bp.connect(g);
      s.start();
      lfo.start();
      this.ambNodes.push({ src: lfo, gain: g });
      return s;
    }, vol);
  }

  /* ---- scene switching ---- */
  setScene(scene) {
    if (!this.ctx) return;
    if (scene === this.scene) return;
    this.scene = scene;
    this.clearAmb();
    switch (scene) {
      case "intake":
        this.hum(110, 0.035);
        this.crackle();
        this.roomtone(0.02);
        break;
      case "stairs":
        this.roomtone(0.035);
        this.drips(1300, 3000, 0.16);
        break;
      case "shaft":
        this.wind(0.11);
        this.groans();
        break;
      case "hall":
        this.drone(0.09);
        this.drips(3200, 8000, 0.1);
        this.groans();
        break;
      case "water":
        this.water(0.2);
        this.drips(1800, 4600, 0.13);
        break;
      case "surface":
        this.wind(0.05);
        break;
      default:
        break; // silence
    }
  }

  /* ---- foley helpers ---- */
  route(g, pan) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
  }

  burst(t, opts) {
    // one shaped puff of filtered noise — scrapes, sloshes, cracks
    const o = Object.assign(
      { buf: "white", type: "bandpass", freq: 800, q: 1, vol: 0.1, attack: 0.006, decay: 0.2, pan: 0 },
      opts
    );
    const s = this.ctx.createBufferSource();
    s.buffer = o.buf === "brown" ? this.brownBuf : this.whiteBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.value = o.freq;
    f.Q.value = o.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    s.connect(f);
    f.connect(g);
    this.route(g, o.pan);
    s.start(t);
    s.stop(t + o.attack + o.decay + 0.1);
  }

  ping(t, opts) {
    // one struck tone — tinks, thuds, rungs, keys
    const o = Object.assign(
      { freq: 1000, glide: 0.5, type: "triangle", vol: 0.06, decay: 0.15, pan: 0 },
      opts
    );
    const osc = this.ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, o.freq * o.glide), t + o.decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    osc.connect(g);
    this.route(g, o.pan);
    osc.start(t);
    osc.stop(t + o.decay + 0.05);
  }

  ringBurst(t, muffled) {
    // an old phone: trilled tone. muffled = ringing from under the water
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = muffled ? 1180 : 1420;
    const trill = this.ctx.createOscillator();
    trill.type = "square";
    trill.frequency.value = 21;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.5;
    const am = this.ctx.createGain();
    am.gain.value = 0.5;
    trill.connect(depth);
    depth.connect(am.gain);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(muffled ? 0.035 : 0.08, t + 0.05);
    g.gain.setValueAtTime(muffled ? 0.035 : 0.08, t + 1.0);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.15);
    osc.connect(am);
    if (muffled) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 360;
      am.connect(lp);
      lp.connect(g);
    } else {
      am.connect(g);
    }
    this.route(g, muffled ? 0 : 0.35);
    osc.start(t);
    trill.start(t);
    osc.stop(t + 1.25);
    trill.stop(t + 1.25);
  }

  /* ---- interaction foley: plays once, as if your hands did it ---- */
  sfx(name) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case "pen": {
        // signing the sheet: three dry scratches
        [0, 0.22, 0.48].forEach((d, i) =>
          this.burst(t + d, { type: "highpass", freq: 2600, vol: 0.035, decay: 0.12 + (i === 2 ? 0.08 : 0), pan: 0.2 })
        );
        break;
      }
      case "steps": {
        // your boots on wet concrete, walking away from the light
        for (let i = 0; i < 5; i++) {
          const d = i * 0.42;
          this.ping(t + d, { freq: 74, glide: 0.6, type: "sine", vol: 0.09 - i * 0.012, decay: 0.12 });
          this.burst(t + d + 0.015, { type: "lowpass", freq: 500, vol: 0.02, decay: 0.06 });
        }
        break;
      }
      case "elevator": {
        // cage rattles shut, motor takes the strain
        [0, 0.09, 0.2, 0.34].forEach((d) =>
          this.burst(t + d, { freq: 1700 + Math.random() * 700, q: 7, vol: 0.09, decay: 0.09 })
        );
        this.ping(t + 0.42, { freq: 130, glide: 0.5, type: "sine", vol: 0.08, decay: 0.2 });
        const motor = this.ctx.createOscillator();
        motor.type = "sawtooth";
        motor.frequency.setValueAtTime(66, t + 0.5);
        motor.frequency.linearRampToValueAtTime(48, t + 2.6);
        const lp = this.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 220;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + 0.5);
        g.gain.linearRampToValueAtTime(0.05, t + 0.9);
        g.gain.linearRampToValueAtTime(0.0001, t + 2.7);
        motor.connect(lp);
        lp.connect(g);
        g.connect(this.master);
        motor.start(t + 0.5);
        motor.stop(t + 2.8);
        break;
      }
      case "pry": {
        // fingers in the seam, metal screaming
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(380, t);
        o.frequency.linearRampToValueAtTime(940, t + 0.9);
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 800;
        bp.Q.value = 4;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.055, t + 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
        o.connect(bp);
        bp.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + 1.1);
        break;
      }
      case "toolbox": {
        // lid cracks, then hands rummaging: tinks and scrapes
        this.burst(t, { freq: 900, q: 3, vol: 0.16, decay: 0.14 });
        this.ping(t + 0.02, { freq: 240, glide: 0.4, type: "square", vol: 0.05, decay: 0.1 });
        for (let i = 0; i < 8; i++) {
          const d = 0.35 + i * 0.13 + Math.random() * 0.06;
          if (Math.random() < 0.55) {
            this.ping(t + d, { freq: 800 + Math.random() * 1700, glide: 0.85, vol: 0.035, decay: 0.07, pan: Math.random() * 0.6 - 0.3 });
          } else {
            this.burst(t + d, { freq: 600 + Math.random() * 700, q: 2, vol: 0.03, decay: 0.09, pan: Math.random() * 0.6 - 0.3 });
          }
        }
        break;
      }
      case "door": {
        // an office door easing open on old hinges
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(170, t);
        o.frequency.linearRampToValueAtTime(260, t + 0.7);
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 400;
        bp.Q.value = 5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.03, t + 0.25);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.8);
        o.connect(bp);
        bp.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + 0.9);
        break;
      }
      case "keys": {
        // brass keys lifted off a nail, careful, almost silent
        [0, 0.13, 0.31].forEach((d) =>
          this.ping(t + d, { freq: 3200 + Math.random() * 1600, glide: 0.9, type: "sine", vol: 0.028, decay: 0.09, pan: 0.25 })
        );
        break;
      }
      case "unlock": {
        // one key, one lock, one soft forgivable clack
        this.ping(t, { freq: 3600, glide: 0.9, type: "sine", vol: 0.025, decay: 0.07 });
        this.ping(t + 0.5, { freq: 210, glide: 0.5, type: "square", vol: 0.05, decay: 0.09 });
        break;
      }
      case "pages": {
        // dry paper turning
        [0, 0.5].forEach((d) =>
          this.burst(t + d, { freq: 1400, q: 0.8, vol: 0.035, decay: 0.22, attack: 0.05 })
        );
        break;
      }
      case "wade_slow": {
        // rolling each step heel to toe through black water
        for (let i = 0; i < 4; i++) {
          this.burst(t + i * 0.75, { buf: "brown", type: "lowpass", freq: 520, vol: 0.085, decay: 0.4, attack: 0.06, pan: i % 2 ? 0.15 : -0.15 });
        }
        break;
      }
      case "wade_fast": {
        // splashing, loud, everywhere
        for (let i = 0; i < 7; i++) {
          this.burst(t + i * 0.3, { type: "lowpass", freq: 950, vol: 0.14, decay: 0.22, attack: 0.01, pan: i % 2 ? 0.25 : -0.25 });
        }
        break;
      }
      case "climb": {
        // boots on rusted rungs, going up
        for (let i = 0; i < 5; i++) {
          const d = i * 0.4;
          this.ping(t + d, { freq: 420 + i * 30, glide: 0.7, vol: 0.045, decay: 0.11 });
          this.ping(t + d + 0.03, { freq: 80, glide: 0.6, type: "sine", vol: 0.05, decay: 0.09 });
        }
        break;
      }
      case "climb_fast": {
        // climbing for your life
        for (let i = 0; i < 8; i++) {
          const d = i * 0.22;
          this.ping(t + d, { freq: 430 + i * 40, glide: 0.7, vol: 0.055, decay: 0.09 });
          this.ping(t + d + 0.02, { freq: 84, glide: 0.6, type: "sine", vol: 0.06, decay: 0.08 });
        }
        break;
      }
      case "cut_chain": {
        // the bolt cutters: strain, CRUNCH, chain pouring down
        this.ping(t, { freq: 150, glide: 0.6, type: "sawtooth", vol: 0.03, decay: 0.35 });
        this.burst(t + 0.55, { freq: 420, q: 2, vol: 0.24, decay: 0.18, attack: 0.003 });
        this.ping(t + 0.56, { freq: 95, glide: 0.4, type: "square", vol: 0.09, decay: 0.15 });
        for (let i = 0; i < 9; i++) {
          const d = 0.8 + i * 0.07 + Math.random() * 0.04;
          this.ping(t + d, { freq: 2400 - i * 180, glide: 0.8, vol: 0.04, decay: 0.06, pan: Math.random() * 0.5 - 0.25 });
        }
        break;
      }
      case "unbolt": {
        // link by link, lowered like a sleeping baby
        for (let i = 0; i < 3; i++) {
          this.burst(t + i * 0.85, { freq: 320, q: 3, vol: 0.03, decay: 0.35, attack: 0.09 });
        }
        this.ping(t + 2.7, { freq: 190, glide: 0.6, type: "sine", vol: 0.03, decay: 0.12 });
        break;
      }
      case "phone_answer": {
        // thumb on glass, then wet static
        this.ping(t, { freq: 1900, glide: 0.9, vol: 0.04, decay: 0.05 });
        this.burst(t + 0.25, { freq: 1100, q: 0.7, vol: 0.05, decay: 1.4, attack: 0.2 });
        break;
      }
      case "phone_silence": {
        // crushing the volume switch — then it rings again, below
        this.ping(t, { freq: 2100, glide: 0.9, vol: 0.035, decay: 0.05 });
        const timer = setTimeout(() => {
          if (!this.ctx) return;
          const t2 = this.ctx.currentTime;
          this.ringBurst(t2, true);
          this.ringBurst(t2 + 2.0, true);
        }, 2600);
        this.ambTimers.push(timer);
        break;
      }
      case "hatch": {
        // sixty feet of rungs end at hinges someone once oiled
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(120, t);
        o.frequency.linearRampToValueAtTime(195, t + 0.8);
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 350;
        bp.Q.value = 5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.04, t + 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.9);
        o.connect(bp);
        bp.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + 1);
        this.ping(t + 0.95, { freq: 210, glide: 0.4, type: "square", vol: 0.08, decay: 0.25 });
        this.burst(t + 1.1, { type: "lowpass", freq: 700, vol: 0.05, decay: 1.2, attack: 0.35 });
        break;
      }
      case "phone_ring": {
        this.ringBurst(t, false);
        this.ringBurst(t + 2.0, false);
        break;
      }
      default:
        break;
    }
  }

  /* ---- stingers ---- */
  whisper(intense) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    s.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(1100, t);
    bp.frequency.linearRampToValueAtTime(2600, t + 1.1);
    bp.frequency.linearRampToValueAtTime(800, t + 2.5);
    // sibilant tremolo — the "consonants" of a voice with no words
    const trem = this.ctx.createGain();
    trem.gain.value = 0.55;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 8 + Math.random() * 5;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG);
    lfoG.connect(trem.gain);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(intense ? 0.13 : 0.06, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    s.connect(bp);
    bp.connect(trem);
    trem.connect(g);
    if (pan) {
      pan.pan.setValueAtTime(Math.random() * 1.4 - 0.7, t);
      pan.pan.linearRampToValueAtTime(Math.random() * 1.4 - 0.7, t + 2.6);
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    s.start(t);
    lfo.start(t);
    s.stop(t + 3.1);
    lfo.stop(t + 3.1);
  }

  clank() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 900;
    bp.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + 0.55);
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(310, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.05, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  /* ---- foley primitives: filtered noise bursts and pitched tones ---- */
  nburst(o) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.at || 0);
    const dur = o.dur || 0.15;
    const s = this.ctx.createBufferSource();
    s.buffer = o.buf === "brown" ? this.brownBuf : this.whiteBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type || "bandpass";
    f.frequency.setValueAtTime(o.freq || 800, t);
    if (o.sweep) f.frequency.linearRampToValueAtTime(o.sweep, t + dur);
    f.Q.value = o.q == null ? 4 : o.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.08, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.1);
  }

  tone(o) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.at || 0);
    const dur = o.dur || 0.2;
    const osc = this.ctx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f0 || 200, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.06, t + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  /* ---- one-shot interaction foley, played on the button press ----
     Everything stays quiet: these are things YOU do, heard the way
     you hear yourself in a place where you're trying not to be heard. */
  foley(name) {
    if (!this.ensure()) return;
    switch (name) {
      case "pen": // signing the sheet
        for (let i = 0; i < 4; i++)
          this.nburst({ freq: 2800 + Math.random() * 800, q: 2, vol: 0.03, dur: 0.09 + Math.random() * 0.08, at: i * 0.16 });
        break;
      case "paper": // pages, the logbook
        this.nburst({ type: "highpass", freq: 3200, q: 0.7, vol: 0.035, dur: 0.35 });
        this.nburst({ type: "highpass", freq: 2800, q: 0.7, vol: 0.03, dur: 0.3, at: 0.45 });
        break;
      case "footsteps": // careful boots on wet concrete
        for (let i = 0; i < 3; i++) {
          this.tone({ f0: 72, f1: 44, vol: 0.07, dur: 0.13, at: i * 0.55 });
          this.nburst({ buf: "brown", freq: 500, q: 1, vol: 0.02, dur: 0.08, at: i * 0.55 });
        }
        break;
      case "elevator": // cage shriek, motor engages, descent rattle
        this.nburst({ freq: 1500, sweep: 2700, q: 9, vol: 0.1, dur: 0.55 });
        this.tone({ type: "sawtooth", f0: 66, f1: 54, vol: 0.045, dur: 2.4, at: 0.7 });
        [0.9, 1.4, 1.9].forEach((at) =>
          this.nburst({ freq: 1100 + Math.random() * 600, q: 8, vol: 0.035, dur: 0.08, at })
        );
        break;
      case "pry": // straining against the doors
        this.tone({ type: "sawtooth", f0: 160, f1: 70, vol: 0.055, dur: 1.2 });
        [0.15, 0.45, 0.8].forEach((at) =>
          this.nburst({ freq: 650, q: 12, vol: 0.05, dur: 0.12, at })
        );
        break;
      case "door": // the office door, unwilling hinges
        this.tone({ type: "sawtooth", f0: 210, f1: 105, vol: 0.03, dur: 0.9 });
        this.nburst({ freq: 1700, sweep: 850, q: 10, vol: 0.035, dur: 0.6, at: 0.05 });
        break;
      case "toolbox": // lid crack, then rummaging metal
        this.nburst({ freq: 1900, q: 2, vol: 0.16, dur: 0.07 });
        for (let i = 0; i < 5; i++)
          this.nburst({ freq: 1300 + Math.random() * 1900, q: 11, vol: 0.04 + Math.random() * 0.04, dur: 0.07, at: 0.3 + i * 0.18 + Math.random() * 0.06 });
        break;
      case "keys": // brass jingle, held tight too late
        for (let i = 0; i < 6; i++)
          this.tone({ type: "triangle", f0: 2300 + Math.random() * 1600, vol: 0.028, dur: 0.05, at: i * 0.07 + Math.random() * 0.04 });
        break;
      case "unlock": // one key, one careful clack
        this.tone({ type: "triangle", f0: 2600, vol: 0.02, dur: 0.05 });
        this.nburst({ freq: 620, q: 8, vol: 0.06, dur: 0.09, at: 0.35 });
        break;
      case "wade_slow": // rolling heel to toe through black water
        [0, 0.95].forEach((at) =>
          this.nburst({ buf: "brown", freq: 320, sweep: 170, q: 0.9, vol: 0.12, dur: 0.55, at })
        );
        break;
      case "wade_fast": // splash be damned
        for (let i = 0; i < 5; i++) {
          this.nburst({ buf: "brown", freq: 480, sweep: 240, q: 0.9, vol: 0.14, dur: 0.28, at: i * 0.28 });
          this.nburst({ freq: 1400, q: 1.2, vol: 0.04, dur: 0.12, at: i * 0.28 });
        }
        break;
      case "ladder": // rungs, taken deliberately
        for (let i = 0; i < 4; i++)
          this.nburst({ freq: 850 + i * 160, q: 9, vol: 0.06, dur: 0.1, at: i * 0.42 });
        break;
      case "ladder_fast": // rungs, taken for your life
        for (let i = 0; i < 7; i++)
          this.nburst({ freq: 800 + i * 140, q: 9, vol: 0.08, dur: 0.09, at: i * 0.2 });
        break;
      case "cut": // bolt cutters: strain, CRUNCH, chain falls
        this.tone({ type: "sawtooth", f0: 95, f1: 70, vol: 0.045, dur: 0.5 });
        this.nburst({ freq: 700, q: 2, vol: 0.22, dur: 0.12, at: 0.5 });
        this.tone({ f0: 62, f1: 34, vol: 0.16, dur: 0.3, at: 0.5 });
        for (let i = 0; i < 6; i++)
          this.nburst({ freq: 1600 - i * 130, q: 10, vol: 0.05 - i * 0.005, dur: 0.07, at: 0.68 + i * 0.11 });
        break;
      case "chain_soft": // links lowered like sleeping babies
        [0, 0.7, 1.4, 2.0].forEach((at) =>
          this.nburst({ freq: 1200 + Math.random() * 500, q: 10, vol: 0.035, dur: 0.08, at })
        );
        break;
      case "hatch": // the last door, and air
        this.tone({ type: "sawtooth", f0: 75, f1: 42, vol: 0.06, dur: 1.3 });
        this.tone({ f0: 55, f1: 30, vol: 0.14, dur: 0.25, at: 1.3 });
        this.nburst({ freq: 900, sweep: 380, q: 1, vol: 0.07, dur: 1.1, at: 1.45 });
        break;
      case "phone": // answering: click, then wet static
        this.nburst({ freq: 2600, q: 3, vol: 0.06, dur: 0.04 });
        this.nburst({ type: "highpass", freq: 2200, q: 0.8, vol: 0.045, dur: 0.9, at: 0.12 });
        break;
      case "click": // the volume switch, crushed
        this.nburst({ freq: 2400, q: 5, vol: 0.05, dur: 0.05 });
        break;
      default:
        this.clank();
    }
  }

  deathHit() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 2.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 3);
    const s = this.ctx.createBufferSource();
    s.buffer = this.brownBuf;
    s.loop = true;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.18, t + 0.9);
    sg.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    s.connect(sg);
    sg.connect(this.master);
    s.start(t);
    s.stop(t + 2.8);
  }

  heartbeat(noise) {
    if (this.heartTimer) {
      clearTimeout(this.heartTimer);
      this.heartTimer = null;
    }
    if (!this.ctx || noise < 4) return;
    const interval = Math.max(520, 1180 - noise * 78);
    const vol = 0.08 + noise * 0.018;
    const beat = () => {
      this.thump(vol);
      setTimeout(() => this.thump(vol * 0.65), 175);
      this.heartTimer = setTimeout(beat, interval);
    };
    this.heartTimer = setTimeout(beat, 300);
  }

  thump(vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }
}

/* which ambient bed plays where — resolved from the chapter label */
function sceneFor(node, chapter) {
  if (node.isTitle) return "silence";
  if (node.death && !node.ending) return "silence"; // the station goes quiet when it has you
  if (/SURFACE ACCESS|GALLERY|BLACK WATER|GANTRY|ANNEX/.test(chapter)) return "water";
  if (/^SURFACE$/.test(chapter)) return "surface";
  if (/INTAKE|LOGBOOK/.test(chapter)) return chapter.includes("LOGBOOK") ? "hall" : "intake";
  if (/STAIRWELL/.test(chapter)) return "stairs";
  if (/ELEVATOR|LADDER/.test(chapter)) return "shaft";
  if (/PUMP HALL|OFFICE/.test(chapter)) return "hall";
  return "silence";
}

/* nodes where it speaks — each gets a faint whisper under the text */
const WHISPER_NODES = new Set([
  "pumphall",
  "pumphall_answer",
  "pumphall_silent",
  "toolbox",
  "ambush",
  "gantry_answer",
  "annex_drown",
  "stillwater",
  "climax",
  "climb_silent",
  "name_falter",
  "ending_wrongname",
  "ending_replaced",
]);

/* foley that fires on arriving somewhere, timed to land mid-text */
const ENTER_SFX = {
  gantry: { name: "phone_ring", delay: 2400 },
  annex_key: { name: "unlock", delay: 2000 },
  ending_escape: { name: "hatch", delay: 400 },
};


const NODES = {
  /* ---------------- TITLE ---------------- */
  title: {
    chapter: "MUNICIPAL WATER AUTHORITY",
    text:
      "WORK ORDER 4471-C\n\nGreywater Station Six. Decommissioned pumping station, Sublevels 0 through 3. Scheduled demolition: Friday.\n\nOne (1) night inspector required to walk the sublevels and confirm the station is clear of personnel, squatters, and equipment worth salvage.\n\nYou are the inspector. Your shift starts at 2:00 a.m.\n\nA note is stapled to the work order in handwriting you don't recognize:\n\n\"If you hear anyone down there, do not answer. Sound carries. Words carry further.\"\n\n(Headphones recommended. The station makes sounds.)",
    choices: [{ label: "Clock in", sfx: "pen", to: "intake" }],
    isTitle: true,
  },

  /* ---------------- SUBLEVEL 0 ---------------- */
  intake: {
    chapter: "SUBLEVEL 0 — INTAKE",
    text:
      "The intake room smells like wet pennies. One fluorescent tube still works, and it works the way a dying insect works — in spasms.\n\nThe sign-in sheet is on a clipboard chained to the desk. Procedure says you sign it. Above the line where your pen is about to land, there's one other entry for tonight.\n\nSigned in: 11:14 p.m. Three hours ago.\n\nNo one else was scheduled. No one signed out.\n\nAt the back of the room: a stairwell door, and the cage of a service elevator, its call button glowing a patient orange.",
    choices: [
      { label: "Look closer at the earlier signature", sfx: "pages", to: "sheet" },
      { label: "Take the stairs — slow, quiet", sfx: "steps", to: "stairs" },
      {
        label: "Take the service elevator — fast, loud", sfx: "elevator",
        to: "elevator",
        noise: 2,
      },
    ],
  },

  sheet: {
    chapter: "SUBLEVEL 0 — INTAKE",
    text:
      "You tilt the clipboard toward the guttering light.\n\nThe earlier signature is yours.\n\nNot similar to yours. Yours. The way you drop the tail on the last letter. The little hook you've made since you were nine. Dated tonight, 11:14 p.m., in ink that has had three hours to dry and somehow hasn't.\n\nYou were home at 11:14. You were asleep at 11:14.\n\nYou sign the next line down, because procedure says you sign it, and because refusing feels like admitting something you're not ready to admit. The two signatures sit one above the other like a before and after.",
    choices: [
      { label: "Take the stairs — slow, quiet", sfx: "steps", to: "stairs" },
      {
        label: "Take the service elevator — fast, loud", sfx: "elevator",
        to: "elevator",
        noise: 2,
      },
    ],
  },

  stairs: {
    chapter: "STAIRWELL A",
    text:
      "The stairwell drops away under your flashlight in switchbacks of wet concrete. Somewhere below, water is dripping — a slow, fat drip with a strange rhythm to it.\n\nDrip. Drip-drip. Pause.\n\nDrip. Drip-drip. Pause.\n\nIt takes you two flights to realize what the rhythm is. It's breathing. The cadence of it. In. In-out. Hold.\n\nYour boots are the loudest thing in the world.",
    choices: [
      { label: "Stop. Hold your breath. Listen", to: "listen" },
      { label: "Keep descending, step by careful step", sfx: "steps", to: "pumphall" },
    ],
  },

  listen: {
    chapter: "STAIRWELL A",
    text:
      "You stop on the landing and hold your breath.\n\nThe dripping stops too.\n\nNot faded. Not slowed. Stopped — the same instant you did, the way your reflection stops when you do.\n\nYou stand in the dark with your lungs burning, and the station stands with you, and you understand that the correct move is to never make another sound as long as you live. Your body can't honor that. You exhale.\n\nThe dripping resumes. In. In-out. Hold.\n\nIt is matching you. It has been matching you since the door.",
    choices: [
      { label: "Keep descending — quieter than you've ever been", sfx: "steps", to: "pumphall" },
    ],
  },

  elevator: {
    chapter: "SERVICE ELEVATOR",
    text:
      "The cage door concertinas shut with a shriek of dry metal that goes everywhere — up the shaft, down the shaft, out into three floors of dark you can't see. If anything down there didn't know you'd arrived, it knows now.\n\nThe elevator descends, rattling. Sublevel 1 crawls past the cage.\n\nThen the light stutters, the motor groans down an octave, and the car stops. Between floors. Above you, in the shaft, something crosses. Not falls — crosses. A long, deliberate weight moving from one side to the other, and the cables sway with it like seaweed.\n\nIt is directly over the car. The ceiling panel is thin enough to dent under a boot.",
    choices: [
      {
        label: "Force the doors and squeeze out — now", sfx: "pry",
        to: "elevator_pry",
        noise: 2,
      },
      {
        label: "Go still. Absolutely still. Wait it out",
        to: "elevator_wait",
      },
    ],
  },

  elevator_pry: {
    chapter: "SERVICE ELEVATOR",
    death: "PRIED",
    text:
      "You get your fingers into the rubber seam and haul. The doors give an inch, screaming the whole way, and the scream goes straight up the shaft like an invitation.\n\nThe weight above you stops moving.\n\nYou pull harder. The gap is almost wide enough. Sublevel 2's floor sits at your chest height; you could climb it, you can already feel yourself climbing it —\n\nThe ceiling panel does not burst open. That's the thing you'll have time to be surprised by: how gently it opens, like a lid, like something that has done this before and learned that hurrying spoils it.\n\nThe last thing you hear is your own voice saying \"okay, okay, easy\" — except your mouth isn't moving, and the voice is coming from above.\n\n— INCIDENT ADDENDUM —\nService elevator recovered at Sublevel 3, doors open, interior undamaged. Inspector's flashlight found upright on the car floor, switched on, pointed at the ceiling.",
  },

  elevator_wait: {
    chapter: "SERVICE ELEVATOR",
    text:
      "You go still the way prey goes still — everything shut down except your heart, which is a hammer in a locked room.\n\nThe weight above you shifts. Settles. You can hear it deciding.\n\nA minute. Two. A drop of water falls through the ceiling seam and lands on the back of your neck, and it takes everything you have not to flinch, because the drop is warm.\n\nThen the motor coughs, the light steadies, and the car resumes its descent like nothing happened. Whatever was above you doesn't follow. You feel it staying, the way you feel a stare.\n\nThe cage opens on Sublevel 2. You step out and do not look up the shaft.",
    choices: [{ label: "Into the pump hall", sfx: "steps", to: "pumphall" }],
  },

  /* ---------------- SUBLEVEL 2 — PUMP HALL ---------------- */
  pumphall: {
    chapter: "SUBLEVEL 2 — PUMP HALL",
    text: (s) =>
      (s.noise >= 2
        ? "The pump hall opens around your flashlight like a cathedral with the god removed. Six turbine pumps the size of buses, dead for a decade, squat in their pits. Every sound you've made tonight arrived here before you did — you can feel it in the quality of the silence, which is not empty. It is attentive.\n\n"
        : "The pump hall opens around your flashlight like a cathedral with the god removed. Six turbine pumps the size of buses, dead for a decade, squat in their pits. Your quiet has bought you something: the dark here feels unbothered. Asleep, if it sleeps.\n\n") +
      "Then, from the far end of the hall, past pump six, a voice calls out.\n\n\"Hello? Is somebody there?\"\n\nIt is your voice. Not like your voice. Your voice — pitched exactly, worn exactly, the voice you hear on recordings and hate. It sounds frightened. It sounds like you, alone in the dark, hoping for help.\n\nTo your left: a supervisor's office, door ajar. To your right, by pump three: a steel toolbox on a workbench.",
    choices: [
      {
        label: "Answer it — \"Who's there?\"",
        to: "pumphall_answer",
        noise: 2,
        words: 2,
      },
      { label: "Say nothing. Kill your light", to: "pumphall_silent" },
      { label: "Slip into the supervisor's office", sfx: "door", to: "office" },
      { label: "Check the toolbox by pump three", sfx: "toolbox", to: "toolbox", noise: 2 },
    ],
  },

  pumphall_answer: {
    chapter: "SUBLEVEL 2 — PUMP HALL",
    text:
      "\"Who's there?\" Your words leave you before you can call them back, and the hall takes them and carries them to the far dark, handing them over.\n\nA pause. Long enough for hope.\n\nThen your voice comes back to you from past pump six:\n\n\"Who's there?\"\n\nThe same words. Your inflection. But wrong in one hair-fine way — it puts the fear in a slightly different place than you did, like a forger practicing a signature. Then, quieter, more to itself than to you, in your voice, it says:\n\n\"Who's. There. Who's there. Whosthere.\"\n\nIt is tasting them.\n\nYou will not be answering it again. The office door is to your left; the toolbox to your right.",
    choices: [
      { label: "Slip into the supervisor's office", sfx: "door", to: "office", hideIfVisited: "office" },
      { label: "Check the toolbox by pump three", sfx: "toolbox", to: "toolbox", noise: 2, hideIfVisited: "toolbox" },
      { label: "Push on toward the flooded gallery", sfx: "steps", to: "gallery_gate" },
    ],
  },

  pumphall_silent: {
    chapter: "SUBLEVEL 2 — PUMP HALL",
    text:
      "You thumb the flashlight off and stand in a dark so total it has texture.\n\nThe voice tries again. \"Hello? Please — I can hear you breathing.\"\n\nYou clamp your mouth shut. You breathe through your nose, slow, the way you'd breathe next to a sleeping animal.\n\nThe silence stretches. Then the voice changes. The fright drains out of it all at once — not gradually, like a person calming down, but instantly, like an actor stepping off stage. Flat now. Patient. Still yours.\n\n\"I know you're there,\" it says. \"I signed us in.\"\n\nYou put your light back on because the dark is worse. The office door is to your left; the toolbox to your right.",
    choices: [
      { label: "Slip into the supervisor's office", sfx: "door", to: "office", hideIfVisited: "office" },
      { label: "Check the toolbox by pump three", sfx: "toolbox", to: "toolbox", noise: 2, hideIfVisited: "toolbox" },
      { label: "Push on toward the flooded gallery", sfx: "steps", to: "gallery_gate" },
    ],
  },

  office: {
    chapter: "SUPERVISOR'S OFFICE",
    text:
      "The office is a glass box full of dead paperwork. A mug on the desk grows something with ambitions. On a corkboard, a brass keyring hangs from a nail — stamped tags: ANNEX, GALLERY, SURFACE.\n\nYou lift it off the nail slowly enough that the keys barely whisper against each other.\n\nOn the desk, under a film of dust, lies the station logbook — the old kind, leather, handwritten. It's open, as if someone left mid-entry. Or was interrupted mid-entry.",
    choices: [
      {
        label: "Read the logbook", sfx: "pages",
        to: "logbook",
        gives: "keyring",
      },
      {
        label: "Take the keys and go — no time to read", sfx: "keys",
        to: "pumphall_return",
        gives: "keyring",
      },
    ],
  },

  logbook: {
    chapter: "STATION LOGBOOK",
    setsFlag: "readLog",
    text:
      "The entries start ordinary — flow rates, maintenance, a broken gauge. Then, eleven years ago, the handwriting starts pressing harder into the page.\n\n\"...Kowalski heard his wife down in the gallery calling his name. His wife has been dead since March. He went to look. I want that on record: he heard her, and he went, and we have not found him.\"\n\n\"...It is not a ghost. Ghosts repeat. This thing REHEARSES. It gets better. It got 'help me' from Ade before we pulled him out and now it says 'help me' better than Ade did.\"\n\n\"...Best we can tell it is blind, or near it. It hunts sound. But it hungers for VOICES. Every word you give it, it keeps. It builds you out of your own words like a nest, and when it has enough of you—\"\n\nThe next line is written so hard the pen tore the paper:\n\n\"DO NOT ANSWER IT. DO NOT TELL IT YOUR NAME. IT CANNOT TAKE WHAT YOU DO NOT GIVE.\"\n\nThe entry below that is in different handwriting. Rounder. Almost childlike, like something practicing:\n\n\"do not answer it. do not tell it your name. do not answer it. i signed us in.\"",
    choices: [{ label: "Close the book. Move", sfx: "pages", to: "pumphall_return" }],
  },

  pumphall_return: {
    chapter: "SUBLEVEL 2 — PUMP HALL",
    text:
      "Back in the hall, the dark past pump six has an occupied quality, like a room where someone is pretending not to be home.\n\nThe toolbox still sits on the workbench by pump three. Beyond the pumps, a gate of chain-link marks the mouth of the flooded gallery — the only way down to Sublevel 3 and the surface ladder on its far side. You can hear water in there, moving very slightly. Water shouldn't be moving.",
    choices: [
      { label: "Check the toolbox by pump three", sfx: "toolbox", to: "toolbox", noise: 2, hideIfVisited: "toolbox" },
      { label: "Head for the flooded gallery", sfx: "steps", to: "gallery_gate" },
    ],
  },

  toolbox: {
    chapter: "SUBLEVEL 2 — PUMP HALL",
    text:
      "The toolbox lid is rusted shut. You work your fingers under the lip and lever it up — it gives with a single sharp CRACK that ricochets around the hall like a gunshot, and you freeze, teeth bared, waiting.\n\nFrom the far dark, your own voice, conversational: \"I heard that.\"\n\nInside the box: stripped bolts, a dead multimeter, and — heavy, cold, beautiful — a pair of long-handled bolt cutters. The kind that go through a padlock chain like it's licorice.\n\nYou take them.",
    choices: [
      {
        label: "Slip into the supervisor's office", sfx: "door",
        to: "office",
        gives: "cutters",
        hideIfVisited: "office",
      },
      {
        label: "Head for the flooded gallery", sfx: "steps",
        to: "gallery_gate",
        gives: "cutters",
      },
    ],
  },

  /* ---------------- SUBLEVEL 3 — FLOODED GALLERY ---------------- */
  gallery_gate: {
    chapter: "SUBLEVEL 3 — FLOODED GALLERY",
    redirect: (s) => (s.noise >= 6 ? "ambush" : null),
    text:
      "Stairs take you down into the smell of the gallery before the gallery itself: cold water, old iron, and something else underneath — something sweetish and organic, like a flower shop with the power out.\n\nThe gallery is a tunnel two hundred feet long, flooded to the knee with black water. Your flashlight lies across the surface without getting into it. Halfway down, the skeleton of a pipe gantry runs above the waterline — a catwalk of rusted grating, bolted to the ceiling.\n\nThe far end of the gallery is a door marked SURFACE ACCESS. Two hundred feet. Through the water, or over it.\n\nThe water is not quite still. Every few seconds, somewhere in the dark length of it, there is a soft displacement. Like something repositioning politely.",
    choices: [
      {
        label: "Wade — slow and silent, feeling each step", sfx: "wade_slow",
        to: "wade_slow",
        noise: 1,
      },
      {
        label: "Wade — fast, splash be damned", sfx: "wade_fast",
        to: "wade_fast",
        noise: 3,
      },
      { label: "Climb to the gantry and cross above", sfx: "climb", to: "gantry" },
    ],
  },

  ambush: {
    chapter: "SUBLEVEL 3 — FLOODED GALLERY",
    death: "HEARD",
    text:
      "You've been loud tonight. You know you've been loud. Every shriek of metal, every splash and crack, has been a sentence in a letter, and the letter said: here I am, and here is where I'm going.\n\nIt read the letter. It got here first.\n\nYou're three steps into the black water when you understand the sweet smell isn't coming from the gallery. It's coming from directly behind you, at the mouth of the stairs, where it has been waiting with the patience of something that has never once been late.\n\nYour voice — its copy of your voice — says, very softly, right at your ear:\n\n\"I heard that.\"\n\n— INCIDENT ADDENDUM —\nGallery water tested at demolition: no contaminants, no remains. Audio survey of Sublevel 3 recorded 41 minutes of a voice matching the inspector's, repeating fragments. The fragments do not repeat exactly. Each iteration is slightly improved.",
  },

  wade_slow: {
    chapter: "THE BLACK WATER",
    text:
      "You go in slow. The cold climbs your legs like hands. You move the way the logbook would want you to move — rolling each step from heel to toe, letting the water close around your boot instead of breaking.\n\nFifty feet. Eighty.\n\nSomething long and smooth slides past your left calf. Not bumping you. Tracing you. Taking your measure the way a tailor does, with professional lightness, and continuing on.\n\nYou do not scream. You will be proud of that for the rest of your life, however long that turns out to be.\n\nA hundred and fifty feet. The SURFACE ACCESS door resolves out of the dark, and beside it, half-submerged, the mouth of a side passage — a plaque above it: ANNEX.",
    choices: [{ label: "Reach the far platform", sfx: "wade_slow", to: "gallery_far" }],
  },

  wade_fast: {
    chapter: "THE BLACK WATER",
    text:
      "You go in loud and fast, because slow means being in this water longer, and every animal instinct you have is screaming that the water is the whole problem.\n\nYour splashing fills the tunnel. Fifty feet. Eighty. Behind you — you don't look, you will not look — the soft displacements are no longer soft, and no longer behind you so much as beside you, pacing you in the dark just past your light, effortless, interested.\n\nA hundred and fifty feet. Your lungs are fire. The SURFACE ACCESS door resolves out of the dark, and beside it, half-submerged, a side passage marked ANNEX.\n\nThe pacing thing stops when you stop. The water rocks, and stills, and waits.",
    choices: [{ label: "Haul out onto the far platform", sfx: "wade_fast", to: "gallery_far", noise: 1 }],
  },

  gantry: {
    chapter: "THE GANTRY",
    text:
      "You climb the access ladder and pull yourself onto the gantry. The grating is rust and prayer, but it holds, and below you the black water slides past like the back of something enormous.\n\nYou're halfway across — a hundred feet of dark on either side — when your phone rings.\n\nThe sound is obscene up here. The screen lights the whole gantry: MOM. It's 3:12 a.m. Your mother has not called past nine o'clock in fifteen years.\n\nBelow you, the water has gone absolutely still. Listening.",
    choices: [
      { label: "Answer it — something might be wrong", sfx: "phone_answer", to: "gantry_answer" },
      { label: "Silence it. Let it ring out", sfx: "phone_silence", to: "gantry_ring" },
    ],
  },

  gantry_answer: {
    chapter: "THE GANTRY",
    death: "ANSWERED",
    text:
      "\"Mom?\"\n\nThe connection is wet static, and under the static, breathing. In. In-out. Hold.\n\nThen your mother's voice says your name — and it is her voice, it is exactly her voice, and it is coming from the phone and ALSO from directly below the grating under your feet, in perfect unison, and you understand, one instant too late, that there was never any call. There is no signal down here. There never was.\n\nIt just needed you to stop walking.\n\nThe grating does not break. It opens — bolts sliding back like they were asked nicely.\n\n— INCIDENT ADDENDUM —\nInspector's phone recovered from gallery floor at demolition. Call log shows one incoming call at 3:12 a.m., duration 9 seconds, from the inspector's own number.",
  },

  gantry_ring: {
    chapter: "THE GANTRY",
    text:
      "You crush the volume switch and hold the phone against your chest like a wound, and you keep walking, and the ringing dies.\n\nThree steps of silence.\n\nThen the ringing starts again — the same ringtone, note for note — from under the water, thirty feet below you. Muffled. Patient. It lets it ring the full eight rings, and the whole time, the surface of the black water doesn't move at all.\n\nIt is showing you what it learned. It is showing you that it can.\n\nYou reach the far ladder with your pulse in your teeth and climb down onto the platform. A door marked SURFACE ACCESS. Beside it, half-submerged, a passage marked ANNEX.",
    choices: [{ label: "Take the platform", sfx: "climb", to: "gallery_far" }],
  },

  gallery_far: {
    chapter: "SURFACE ACCESS",
    redirect: (s) => (s.noise >= 8 ? "stillwater" : null),
    text:
      "The SURFACE ACCESS door opens on a concrete throat going straight up — and there it is, the most beautiful thing you have ever seen: a ladder, rungs vanishing upward toward a hatch and the honest, stupid, ordinary night sky somewhere above it.\n\nThe hatch at the bottom of the ladder cage is chained shut. A padlocked chain, city-issue, thick as your thumb.\n\nBehind you, out in the gallery, the water has begun, very slowly, to move toward the platform. No splashing now. No pretense. A long, low bow-wave in the dark, aimed at you, unhurried in a way that is worse than speed.",
    choices: [
      {
        label: "Cut the chain — bolt cutters", sfx: "cut_chain",
        to: "climax",
        requires: "cutters",
        noise: 2,
        missingHint: "You have nothing that cuts",
      },
      {
        label: "The annex passage — find another way around", sfx: "wade_slow",
        to: "annex",
      },
    ],
  },

  stillwater: {
    chapter: "SURFACE ACCESS",
    death: "STILLWATER",
    text:
      "You have spent your whole allowance of sound tonight, and the station has kept the receipts.\n\nYou reach the platform and the water behind you does not chase. It doesn't need to. Because as your light finds the SURFACE ACCESS door, it also finds the water in front of the door — the thin sheet of it standing on the platform itself, two inches deep, which should be flat and dead and still.\n\nIt is still. All of it. Perfectly. Except it is also two feet taller than you, and door-shaped, and it has been standing between you and the exit since before you crossed, wearing the dark like a coat.\n\nYour own voice comes out of it, warm now, almost fond, the way you sound when a long day is finally over:\n\n\"There you are.\"\n\n— INCIDENT ADDENDUM —\nDemolition proceeded on schedule. During pre-blast survey, two workers independently reported a voice from Sublevel 3 asking to be signed out. Survey audio contains no such voice. Both workers correctly stated the inspector's full name. Neither had been told it.",
  },

  annex: {
    chapter: "THE ANNEX",
    redirect: (s) => (s.items.includes("keyring") ? "annex_key" : "annex_drown"),
    text: "",
  },

  annex_key: {
    chapter: "THE ANNEX",
    text:
      "The annex is a drowned service corridor, water to your ribs, ceiling close enough to kiss. Your light shows you a service door twenty feet in — steel, sound, and locked.\n\nThe brass keyring. Tag stamped ANNEX.\n\nYou hold the keys in your fist so they can't sing against each other, fit the right one by feel, and turn it slow. The lock gives with one soft, forgivable clack. Through the door: a dry maintenance stair, spiraling up, and at its top — the underside of the same ladder cage, on the far side of the chained hatch. The chain is bolted from this side.\n\nYou can undo it here, quietly, with your hands.",
    choices: [{ label: "Unbolt the chain and open the cage", sfx: "unbolt", to: "climax", quietRoute: true }],
  },

  annex_drown: {
    chapter: "THE ANNEX",
    death: "UNDERTOW",
    text:
      "The annex is a drowned service corridor, water to your ribs, ceiling close enough to kiss. Twenty feet in, your light shows a steel service door. Locked. City lock. The kind that opens for a key you saw hanging in an office you didn't search, on a corkboard, on a little brass ring.\n\nYou turn around.\n\nThe corridor behind you is longer than it was. That's not fear talking. You counted your steps in — twelve — and you are twenty steps back the way you came and the gallery mouth is not getting closer, and the water is at your chest now though the floor hasn't sloped, and somewhere in the flooded dark ahead of you, between you and the way out, your own voice says, gently, like you'd talk to a scared kid:\n\n\"It's okay. You're almost there. Keep coming.\"\n\nIt has learned to lie in your voice. You gave it enough to lie with.\n\n— INCIDENT ADDENDUM —\nAnnex corridor measured at demolition: 38 feet, as built. Inspector's flashlight recovered 61 feet in.",
  },

  /* ---------------- CLIMAX ---------------- */
  climax: {
    chapter: "THE LADDER",
    text: (s) =>
      (s.quietRoute
        ? "The chain comes away link by link in your hands, each one lowered to the concrete like a sleeping baby. The cage door swings open without a sound. The ladder is yours.\n\n"
        : "The bolt cutters go through the chain with a CRUNCH that fills the shaft — the loudest thing you've done all night, at the worst possible moment to do it. The chain rattles down. The cage is open. The ladder is yours.\n\n") +
      "You get one hand on the third rung.\n\nAnd from the dark at the base of the shaft — close, closer than it has ever let you hear it — your own voice speaks. Calm. Almost kind. The voice you use when you've already won an argument.\n\n\"Hey. Before you go.\"\n\nA pause you could fall into.\n\n\"Say it's really you. Say your name for me. Just once, and I'll let you climb.\"\n\nThe dark below the ladder is very deep, and very close, and it is holding absolutely still — the way you hold still at a door, listening for one particular word.",
    choices: [
      { label: "Say your name — anything to make it let you go", to: "climax_name" },
      { label: "Say nothing. Climb", sfx: "climb", to: "climb_silent" },
      {
        label: "Give it a name — the wrong one. \"Kowalski.\"",
        to: "ending_wrongname",
        requiresFlag: "readLog",
        missingHint: "You don't know any other names down here",
      },
    ],
  },

  climax_name: {
    chapter: "THE LADDER",
    redirect: (s) => (s.words >= 1 ? "ending_replaced" : "name_falter"),
    text: "",
  },

  name_falter: {
    chapter: "THE LADDER",
    text:
      "You say your name into the dark.\n\nAnd the dark says it back — and gets it wrong.\n\nBarely wrong. The stress lands a half-beat early, the vowel a shade too wide. It has never heard you speak. You never gave it one word tonight, and a name alone is not enough thread to sew with, and you can hear it discovering that — the little pause, the retry, your name again, wrong in a new way, and under the calm, for the first time all night, something that might be frustration.\n\nIt is busy practicing. Its attention is on its own mouth.\n\nGo. GO.",
    choices: [{ label: "Climb for your life", sfx: "climb_fast", to: "ending_escape", noise: 3 }],
  },

  climb_silent: {
    chapter: "THE LADDER",
    text:
      "You don't answer. You climb.\n\nThe voice below doesn't rage. That's the horror of it — no shriek, no pursuit, just your own voice following you up the shaft at a conversational volume, patient as a bill collector:\n\n\"That's all right. That's all right. I have your signature. I'll get the rest.\"\n\nYou climb past it. You climb through it. Sixty feet of rungs and the words getting smaller below you, and then the hatch is in your hands.",
    choices: [{ label: "Open the hatch", to: "ending_escape" }],
  },

  /* ---------------- ENDINGS ---------------- */
  ending_escape: {
    chapter: "SURFACE",
    ending: "YOU DID NOT ANSWER",
    text:
      "The hatch swings up on hinges someone, somewhere, once oiled, and the night air hits you like forgiveness. Real dark — the thin, weak, survivable dark of a city at 4 a.m., streetlights, a distant siren, the sky.\n\nYou lie on the concrete apron of the station yard and breathe until breathing feels like yours again.\n\nProcedure says you sign out. The surface kiosk has a clipboard, chained, like the one below. You limp to it. You find tonight's page.\n\nThere are two sign-outs already on it.\n\nThe first is yours — your name, your hook on the last letter — timestamped 3:58 a.m.\n\nIt is 3:51.\n\nThe ink is still wet. And below it, on the next line, in handwriting that is almost yours, getting closer to yours, the second entry reads:\n\n\"see you tomorrow.\"\n\n— END OF SHIFT —\nYou survived Greywater Station. It kept your signature.",
    choices: [{ label: "Clock in again", sfx: "pen", to: "restart" }],
  },

  ending_wrongname: {
    chapter: "THE LADDER",
    ending: "KOWALSKI",
    text:
      "\"Kowalski,\" you say, into the dark. One word. The only word you'll give it.\n\nSilence. Then, from below, tentative, testing:\n\n\"...Kowalski.\"\n\nThe dark says it again, tasting it. \"Kowalski. Kowalski.\" And the attention that has been on you all night — that pressure, like a stare with weight — lifts, and turns inward, and down, toward the flooded places where an old name has been waiting eleven years for someone to say it.\n\nYou climb. Nothing follows. Far below, all the way up the shaft, you can hear it calling — not to you anymore. In a voice that is starting, rung by rung as you climb, to sound like a man you never met:\n\n\"Kowalski? Is somebody there? Hello? I can hear you breathing.\"\n\nThe hatch opens on the 4 a.m. sky. You sign out with a hand that shakes. Yours is the only name on the page.\n\nThree weeks later, at the demolition, they'll find nothing at all. But you will spend the rest of your life not answering the phone when it rings after midnight — because once, just once, on the night of the demolition, someone called and said nothing, and the breathing on the line was a rhythm you knew:\n\nIn. In-out. Hold.\n\n— END OF SHIFT —\nYou fed it the past to buy your future. Yours is the only clean escape. Probably.",
    choices: [{ label: "Clock in again", sfx: "pen", to: "restart" }],
  },

  ending_replaced: {
    chapter: "THE LADDER",
    ending: "SIGNED OUT",
    death: "REPLACED",
    text:
      "You say your name.\n\nAnd the dark below says it back to you — perfectly. Your stress, your vowels, the tiny drop at the end that you've never noticed and would never think to defend. Because it has your \"who's there.\" It has your words from the hall, your breath from the stairwell, your ringtone, your signature. It has been assembling you all night from everything you handed over, and your name was the last piece — the clasp on the necklace.\n\n\"Thank you,\" it says, in your voice, and the terrible thing is that it sounds sincere.\n\nThe dark comes up the shaft past you. It doesn't touch you. It doesn't need to. You hear it reach the hatch above; you hear the hatch open on the night air; you hear your own boots on the surface concrete, walking away, unhurried; and very faintly, before the hatch swings shut, you hear a pen scratch on a clipboard.\n\nIt signs out at 3:58 a.m.\n\nYou are still on the ladder. You are still on the ladder in the dark, and the water below is rising very slowly, and you have all the time in the world to wonder what it will say to your mother, in your voice, when she calls.\n\n— INCIDENT ADDENDUM —\nThe inspector completed the survey and signed out at 3:58 a.m. The inspector filed a normal report. The inspector has since returned to work.\nThe inspector is fine.",
    choices: [{ label: "Clock in again", sfx: "pen", to: "restart" }],
  },
};

/* ============================================================ */

const INITIAL_STATE = {
  node: "title",
  noise: 0,
  words: 0,
  items: [],
  flags: {},
  quietRoute: false,
  visited: [],
};

const NOISE_LABELS = [
  "the station sleeps",
  "the station sleeps",
  "something turned its head",
  "something turned its head",
  "it is listening now",
  "it is listening now",
  "it knows your rhythm",
  "it is moving toward you",
  "it is moving toward you",
  "it is already there",
  "it is already there",
];

export default function GreywaterStation() {
  const [state, setState] = useState(INITIAL_STATE);
  const [shown, setShown] = useState(0); // characters revealed
  const [done, setDone] = useState(false);
  const [endingsFound, setEndingsFound] = useState([]);
  const [deathsFound, setDeathsFound] = useState([]);
  const [reduced, setReduced] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new DreadAudio();
    return audioRef.current;
  };

  const node = NODES[state.node];
  const fullText =
    typeof node.text === "function" ? node.text(state) : node.text;

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  }, []);

  /* typewriter */
  useEffect(() => {
    setShown(0);
    setDone(false);
    if (reduced) {
      setShown(fullText.length);
      setDone(true);
      return;
    }
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 3;
      if (i >= fullText.length) {
        setShown(fullText.length);
        setDone(true);
        clearInterval(timerRef.current);
      } else {
        setShown(i);
      }
    }, 16);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.node, reduced]);

  /* record endings/deaths */
  useEffect(() => {
    if (node.ending && !endingsFound.includes(node.ending)) {
      setEndingsFound((e) => [...e, node.ending]);
    }
    if (node.death && !node.ending && !deathsFound.includes(node.death)) {
      setDeathsFound((d) => [...d, node.death]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.node]);

  /* soundscape: ambient bed per floor, whisper when it speaks, hit on death */
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !a.ctx) return;
    a.setScene(sceneFor(node, node.chapter));
    if (node.death) a.deathHit();
    let wt = null;
    let et = null;
    if (WHISPER_NODES.has(state.node)) {
      wt = setTimeout(() => a.whisper(!!node.death || !!node.ending), 1400);
    }
    if (ENTER_SFX[state.node]) {
      const e = ENTER_SFX[state.node];
      et = setTimeout(() => a.sfx(e.name), e.delay);
    }
    return () => {
      if (wt) clearTimeout(wt);
      if (et) clearTimeout(et);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.node]);

  /* heartbeat tracks the sound meter */
  useEffect(() => {
    const a = audioRef.current;
    if (a && a.ctx) a.heartbeat(node.death || node.isTitle ? 0 : state.noise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.noise, state.node]);

  /* silence everything on unmount */
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.heartbeat(0);
        a.clearAmb();
        if (a.ctx) a.ctx.close();
      }
    };
  }, []);

  const skip = () => {
    if (!done) {
      clearInterval(timerRef.current);
      setShown(fullText.length);
      setDone(true);
    }
  };

  const resolveRedirects = useCallback((id, s) => {
    let cur = id;
    let guard = 0;
    while (guard++ < 10) {
      const n = NODES[cur];
      if (n && n.redirect) {
        const r = n.redirect(s);
        if (r) {
          cur = r;
          continue;
        }
      }
      break;
    }
    return cur;
  }, []);

  const choose = (choice) => {
    /* the click is a user gesture — the only reliable moment to start audio */
    const a = getAudio();
    if (soundOn) {
      a.ensure();
      if (choice.sfx) a.sfx(choice.sfx);
      else if ((choice.noise || 0) >= 2) a.clank();
    }
    if (state.node === "title" || choice.to === "restart") {
      if (choice.to === "restart") {
        setState({ ...INITIAL_STATE, node: "title" });
        return;
      }
    }
    setState((prev) => {
      const next = {
        ...prev,
        noise: Math.min(10, prev.noise + (choice.noise || 0)),
        words: prev.words + (choice.words || 0),
        items: choice.gives && !prev.items.includes(choice.gives)
          ? [...prev.items, choice.gives]
          : prev.items,
        flags: { ...prev.flags },
        quietRoute: choice.quietRoute ? true : prev.quietRoute,
        visited: prev.visited.includes(prev.node)
          ? prev.visited
          : [...prev.visited, prev.node],
      };
      const target = NODES[choice.to];
      if (target && target.setsFlag) next.flags[target.setsFlag] = true;
      next.node = resolveRedirects(choice.to, next);
      return next;
    });
  };

  const isDeath = !!node.death;
  const isEnding = !!node.ending && !node.death;
  const noiseLevel = state.noise;
  const vignette = Math.min(0.75, 0.18 + noiseLevel * 0.055);

  const visibleChoices = (node.choices || []).filter((c) => {
    if (c.hideIfVisited && state.visited.includes(c.hideIfVisited)) return false;
    return true;
  });

  return (
    <div className="gw-root" onClick={skip}>
      <style>{CSS}</style>

      {/* vignette that breathes with noise */}
      <div
        className={"gw-vignette" + (isDeath ? " gw-vign-death" : "")}
        style={{ opacity: isDeath ? 0.9 : vignette }}
      />

      <header className="gw-header">
        <button
          className="gw-sound-toggle"
          onClick={(e) => {
            e.stopPropagation();
            const next = !soundOn;
            setSoundOn(next);
            const a = getAudio();
            a.setEnabled(next);
            if (next) {
              a.ensure();
              a.setScene(sceneFor(node, node.chapter));
              a.heartbeat(node.death || node.isTitle ? 0 : state.noise);
            } else {
              a.heartbeat(0);
            }
          }}
          aria-label={soundOn ? "Mute sound" : "Enable sound"}
        >
          {soundOn ? "sound: on" : "sound: off"}
        </button>
        <div className={"gw-lamp" + (reduced ? " gw-noflicker" : "")}>
          GREYWATER STATION SIX
        </div>
        <div className="gw-sub">night inspection · sublevels 0–3</div>
      </header>

      {!node.isTitle && (
        <div className="gw-meters">
          <div className="gw-meter">
            <span className="gw-meter-label">SOUND</span>
            <span className="gw-ticks">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    "gw-tick" +
                    (i < noiseLevel
                      ? i >= 6
                        ? " gw-tick-hot"
                        : " gw-tick-on"
                      : "")
                  }
                />
              ))}
            </span>
            <span className="gw-meter-note">{NOISE_LABELS[noiseLevel]}</span>
          </div>
          {state.words > 0 && (
            <div className="gw-words">
              it has {state.words} {state.words === 1 ? "word" : "words"} of you
            </div>
          )}
          {state.items.length > 0 && (
            <div className="gw-items">
              carrying:{" "}
              {state.items.map((it) => ITEM_NAMES[it]).join(" · ").toLowerCase()}
            </div>
          )}
        </div>
      )}

      <main className={"gw-main" + (isDeath ? " gw-main-death" : "")}>
        <div className="gw-chapter">
          {isDeath ? "— RECOVERED —" : node.chapter}
        </div>
        <div className="gw-text">
          {fullText.slice(0, shown)}
          {!done && <span className="gw-caret">▌</span>}
        </div>

        {done && (
          <div className="gw-choices">
            {isDeath && !node.choices && (
              <button
                className="gw-btn gw-btn-death"
                onClick={(e) => {
                  e.stopPropagation();
                  setState({ ...INITIAL_STATE, node: "title" });
                }}
              >
                Begin the shift again
              </button>
            )}
            {visibleChoices.map((c, i) => {
              const missingItem = c.requires && !state.items.includes(c.requires);
              const missingFlag = c.requiresFlag && !state.flags[c.requiresFlag];
              const locked = missingItem || missingFlag;
              return (
                <button
                  key={i}
                  className={
                    "gw-btn" +
                    (locked ? " gw-btn-locked" : "") +
                    (isDeath || isEnding ? " gw-btn-death" : "")
                  }
                  disabled={locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!locked) choose(c);
                  }}
                >
                  <span className="gw-btn-label">
                    {locked ? c.missingHint || c.label : c.label}
                  </span>
                  {!locked && c.noise ? (
                    <span className="gw-btn-noise">
                      {"+".repeat(Math.min(3, c.noise))} sound
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </main>

      <footer className="gw-footer">
        <span>
          endings {endingsFound.length}/3 · deaths {deathsFound.length}/5
        </span>
        <span className="gw-hint">{done ? "" : "click to skip"}</span>
      </footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap');

.gw-root {
  min-height: 100vh;
  background: #060a0b;
  color: #b7c2bc;
  font-family: 'Source Serif 4', Georgia, serif;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow-x: hidden;
  cursor: default;
}

.gw-vignette {
  pointer-events: none;
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.92) 100%);
  transition: opacity 1.6s ease;
  z-index: 2;
}
.gw-vign-death {
  background: radial-gradient(ellipse at 50% 45%, rgba(60,8,4,0.15) 20%, rgba(10,0,0,0.96) 100%);
}

.gw-header {
  padding: 28px 24px 10px;
  text-align: center;
  position: relative;
  z-index: 3;
}
.gw-lamp {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: clamp(18px, 3.4vw, 28px);
  letter-spacing: 0.32em;
  color: #dce9e3;
  text-shadow: 0 0 18px rgba(190, 230, 215, 0.28);
  animation: gw-flicker 7s infinite;
}
.gw-noflicker { animation: none; }
@keyframes gw-flicker {
  0%, 100% { opacity: 1; }
  3% { opacity: 0.55; }
  4% { opacity: 1; }
  7% { opacity: 0.8; }
  8% { opacity: 1; }
  43% { opacity: 1; }
  44% { opacity: 0.4; }
  45% { opacity: 0.95; }
  46% { opacity: 0.6; }
  47% { opacity: 1; }
  81% { opacity: 1; }
  82% { opacity: 0.7; }
  83% { opacity: 1; }
}
.gw-sub {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 0.28em;
  color: #57635e;
  margin-top: 8px;
}
.gw-sound-toggle {
  position: absolute;
  top: 14px;
  right: 14px;
  appearance: none;
  background: rgba(14, 20, 19, 0.7);
  border: 1px solid #223029;
  color: #6b7a73;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  padding: 6px 10px;
  cursor: pointer;
  z-index: 4;
  transition: border-color 0.25s, color 0.25s;
}
.gw-sound-toggle:hover {
  border-color: #4a6a5c;
  color: #cdd8d2;
}
.gw-sound-toggle:focus-visible {
  outline: 2px solid #7fb0a0;
  outline-offset: 2px;
}

.gw-meters {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 0;
  position: relative;
  z-index: 3;
}
.gw-meter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.gw-meter-label {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.3em;
  color: #57635e;
}
.gw-ticks { display: inline-flex; gap: 4px; }
.gw-tick {
  width: 9px; height: 14px;
  border: 1px solid #223029;
  background: transparent;
  transition: background 0.6s ease, box-shadow 0.6s ease;
}
.gw-tick-on { background: #3d5a4e; box-shadow: 0 0 6px rgba(90,140,120,0.35); }
.gw-tick-hot { background: #7a2a20; box-shadow: 0 0 8px rgba(160,50,35,0.5); }
.gw-meter-note {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: #6b7a73;
  font-style: normal;
}
.gw-words {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  color: #9c4a3d;
}
.gw-items {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: #57635e;
}

.gw-main {
  flex: 1;
  max-width: 660px;
  width: 100%;
  margin: 0 auto;
  padding: 26px 22px 30px;
  position: relative;
  z-index: 3;
}
.gw-chapter {
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 12px;
  letter-spacing: 0.3em;
  color: #6b7a73;
  border-bottom: 1px solid #16211d;
  padding-bottom: 10px;
  margin-bottom: 20px;
}
.gw-main-death .gw-chapter { color: #a3372a; border-color: #33130e; }

.gw-text {
  font-size: clamp(15.5px, 2.1vw, 17.5px);
  line-height: 1.75;
  white-space: pre-wrap;
  color: #b7c2bc;
  min-height: 140px;
}
.gw-main-death .gw-text { color: #c0b3ad; }
.gw-caret { color: #dce9e3; animation: gw-blink 1s steps(1) infinite; }
@keyframes gw-blink { 50% { opacity: 0; } }

.gw-choices {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: gw-rise 0.7s ease both;
}
@keyframes gw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.gw-btn {
  appearance: none;
  background: rgba(14, 20, 19, 0.85);
  border: 1px solid #223029;
  color: #cdd8d2;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 13.5px;
  letter-spacing: 0.06em;
  text-align: left;
  padding: 13px 16px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  transition: border-color 0.25s, background 0.25s, transform 0.15s;
}
.gw-btn:hover:not(:disabled) {
  border-color: #4a6a5c;
  background: rgba(20, 30, 27, 0.95);
  transform: translateX(3px);
}
.gw-btn:focus-visible {
  outline: 2px solid #7fb0a0;
  outline-offset: 2px;
}
.gw-btn-noise {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #8a4a3d;
  white-space: nowrap;
}
.gw-btn-locked {
  color: #465049;
  border-color: #141d19;
  cursor: not-allowed;
  font-style: italic;
}
.gw-btn-death { border-color: #3a1712; }
.gw-btn-death:hover:not(:disabled) { border-color: #7a2a20; background: rgba(28, 12, 9, 0.9); }

.gw-footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 18px 16px;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #414c46;
  position: relative;
  z-index: 3;
}
.gw-hint { color: #313a35; }

@media (max-width: 480px) {
  .gw-lamp { letter-spacing: 0.18em; }
  .gw-text { font-size: 15.5px; }
}
`;
