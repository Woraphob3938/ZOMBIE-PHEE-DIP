'use strict';
// ---------------------------------------------------------------------------
// Pixel sprites, icons and a tiny 3x5 bitmap font — all generated at runtime.
// ---------------------------------------------------------------------------
const Pix = (() => {
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  // Shared colours. Per-entity palettes override h/s/c/b/p.
  const BASE = {
    e: '#1a1a1a', // eye
    r: '#ff3a3a', // zombie eye
    m: '#6e0000', // bloody mouth
    k: '#2a2020', // shoes
    g: '#2b2b2b', // gun
    w: '#e8e4d0', // bone
    d: '#262626', // bone shadow / sockets
    v: '#7fb0dc', // SWAT visor
    x: '#c01010', // fresh blood on clothes
    o: '#3d4a26', // grenade
    a: '#8cff3a', // acid
    R: '#b8302a', // dynamite
    Y: '#ffe060', // fuse spark
    f: '#6a5a4a', // fuse
    u: '#dcd65a', // pus boils
    V: '#8a2a3a', // swollen veins
    n: '#141414', // dog nose
  };

  // 9-wide templates, feet anchor at column 3. Each type has named animations.
  const T = {
    human: {
      walk: [
        ['..hhh....', '.hhhhh...', '.hsese...', '..sss....', '.ccccc...', 'c.cbc.c..', 's.ccc.s..', '..ppp....', '..p.p....', '..k.k....'],
        ['..hhh....', '.hhhhh...', '.hsese...', '..sss....', '.ccccc...', 'c.cbc.c..', 's.ccc.s..', '..ppp....', '.p...p...', '.k...k...'],
      ],
      // panicked run: arms flailing above the head, mouth open
      run: [
        ['..hhh....', 'shhhhhs..', 'chsese.c.', 'c.sms.c..', '.ccccc...', '..cbc....', '..ccc....', '..ppp....', '.p...p...', 'k.....k..'],
        ['..hhh....', '.hhhhh...', 'shsese.s.', 'c.sms.c..', 'cccccc...', '..cbc....', '..ccc....', '..ppp....', '..pp.....', '..kk.....'],
      ],
      // startled: frozen with both hands up
      shock: [
        ['s.hhh.s..', 'shhhhhs..', 'chsese.c.', 'c.sms.c..', '.ccccc...', '..cbc....', '..ccc....', '..ppp....', '..p.p....', '..k.k....'],
      ],
    },
    armed: {
      walk: [
        ['..hhh....', '.hhhhh...', '.hsese...', '..sss....', '.ccccc...', 'c.cbc.sgg', 's.ccc....', '..ppp....', '..p.p....', '..k.k....'],
        ['..hhh....', '.hhhhh...', '.hsese...', '..sss....', '.ccccc...', 'c.cbc.sgg', 's.ccc....', '..ppp....', '.p...p...', '.k...k...'],
      ],
    },
    swat: {
      walk: [
        ['..hhh....', '.hhhhh...', '.hvvvv...', '..sss....', '.ccccc...', 'c.bbb.sgg', 's.bbb....', '..ppp....', '..p.p....', '..k.k....'],
        ['..hhh....', '.hhhhh...', '.hvvvv...', '..sss....', '.ccccc...', 'c.bbb.sgg', 's.bbb....', '..ppp....', '.p...p...', '.k...k...'],
      ],
      // winding up a grenade throw
      throw: [
        ['..hhh...o', '.hhhhh.s.', '.hvvvvc..', '..sssc...', '.ccccc...', 'c.bbb....', 's.bbb....', '..ppp....', '.p...p...', '.k...k...'],
      ],
    },
    // bosses — big human 15x16, feet anchor col 6. 'g' = signature weapon/item
    boss: {
      walk: [
        ['.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '...ccccbcccc...', '..cccccbccccc..', '.ss.ccccccc.ss.', '.ss.cccccccgggg', '.ss.cccccccgggg', '..s.ccccccc.s..', '....ppppppp....', '....ppp.ppp....', '....ppp.ppp....', '....pp...pp....', '...kkk...kkk...'],
        ['.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '...ccccbcccc...', '..cccccbccccc..', '.ss.ccccccc.ss.', '.ss.cccccccgggg', '.ss.cccccccgggg', '..s.ccccccc.s..', '....ppppppp....', '....ppp.ppp....', '...ppp...ppp...', '...pp.....pp...', '..kkk.....kkk..'],
      ],
      // weapon shouldered and pointed forward, wide stance · frame 2 = recoil
      aim: [
        ['.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '...ccccbccccc..', '..cccccbcssgggg', '.ss.ccccccgggg.', '.ss.ccccccc....', '..s.ccccccc....', '....ccccccc....', '....ppppppp....', '...ppp...ppp...', '...ppp...ppp...', '..pp.......pp..', '.kkk.......kkk.'],
        ['....hhhh.......', '...hhhhhh......', '...hsseses.....', '...sssssss.....', '....ssmss......', '...ccccbcccc...', '..cccccbcssggg.', '.ss.cccccgggg..', '.ss.ccccccc....', '..s.ccccccc....', '....ccccccc....', '....ppppppp....', '...ppp...ppp...', '...ppp...ppp...', '..pp.......pp..', '.kkk.......kkk.'],
      ],
      // both arms raised to the sky, holding the signature item (holy cross / fists)
      cast: [
        ['.gg.........gg.', '..s..hhhh...s..', '..s.hhhhhh..s..', '..s.hsseses.s..', '..s.sssssss.s..', '..ss.ssmss.ss..', '...ccccbcccc...', '..cccccbccccc..', '....ccccccc....', '....ccccccc....', '....ccccccc....', '....ppppppp....', '....ppp.ppp....', '....ppp.ppp....', '....pp...pp....', '...kkk...kkk...'],
        ['.ggg.......ggg.', '..s..hhhh...s..', '..s.hhhhhh..s..', '..s.hsseses.s..', '..s.sssssss.s..', '..ss.ssmss.ss..', '...ccccbcccc...', '..cccccbccccc..', '....ccccccc....', '....ccccccc....', '....ccccccc....', '....ppppppp....', '....ppp.ppp....', '....ppp.ppp....', '....pp...pp....', '...kkk...kkk...'],
      ],
      // overarm throw: wind-up (flask held high) → release (arm swung forward)
      throw: [
        ['...........ggg.', '.....hhhh...s..', '....hhhhhh..s..', '....hsseses.s..', '....sssssssss..', '.....ssmss.....', '...ccccbcccc...', '..cccccbccccc..', '.ss.ccccccc....', '.ss.ccccccc....', '..s.ccccccc....', '....ppppppp....', '...ppp...ppp...', '...ppp...ppp...', '..pp.......pp..', '.kkk.......kkk.'],
        ['.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '...ccccbccccsss', '..cccccbcccc..g', '.ss.ccccccc....', '.ss.ccccccc....', '..s.ccccccc....', '....ccccccc....', '....ppppppp....', '...ppp...ppp...', '...ppp...ppp...', '..pp.......pp..', '.kkk.......kkk.'],
      ],
      // ground slam: fists up high (leap) → crouched impact with arms to the ground
      slam: [
        ['.ss.........ss.', '..s..hhhh...s..', '..s.hhhhhh..s..', '..s.hsseses.s..', '..s.sssssss.s..', '..ss.ssmss.ss..', '...ccccbcccc...', '..cccccbccccc..', '....ccccccc....', '....ccccccc....', '....ccccccc....', '....ppppppp....', '....ppp.ppp....', '....ppp.ppp....', '....pp...pp....', '...kkk...kkk...'],
        ['...............', '...............', '.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '..cccccbcccc...', '.ccccccbccccc..', '.s.ccccccccc.s.', 's..ccccccccc..s', 's..ppppppppp..s', 'ss.ppp...ppp.ss', '..ppp.....ppp..', '..pp.......pp..', '.kkk.......kkk.'],
      ],
      // shoulder-first charge, leaning forward
      charge: [
        ['...............', '......hhhh.....', '.....hhhhhh....', '.....hsseses...', '.....sssssss...', '......ssmss....', '...cccccbccccss', '..ccccccbccccss', '.ss.cccccccc...', 'ss..cccccccc...', '....ccccccc....', '....ppppppp....', '...ppp..ppp....', '..ppp....ppp...', '.pp.......pp...', 'kkk........kkk.'],
        ['...............', '......hhhh.....', '.....hhhhhh....', '.....hsseses...', '.....sssssss...', '......ssmss....', '...cccccbccccss', '..ccccccbccccss', '.ss.cccccccc...', 'ss..cccccccc...', '....ccccccc....', '....ppppppp....', '....ppp.ppp....', '....ppp..ppp...', '...pp.....pp...', '..kkk.....kkk..'],
      ],
      // heavy straight punch
      punch: [
        ['.....hhhh......', '....hhhhhh.....', '....hsseses....', '....sssssss....', '.....ssmss.....', '...ccccbcccc...', '..cccccbcccssss', '.ss.cccccccssss', '.ss.ccccccc....', '..s.ccccccc....', '....ccccccc....', '....ppppppp....', '...ppp...ppp...', '...ppp...ppp...', '..pp.......pp..', '.kkk.......kkk.'],
      ],
      // commander: arm thrust up and forward, shouting orders
      point: [
        ['.............s.', '.....hhhh...s..', '....hhhhhh.s...', '....hssesess...', '....ssssssss...', '.....ssmss.....', '...ccccbcccc...', '..cccccbccccc..', '.ss.ccccccc....', '.ss.cccccccgggg', '..s.cccccccgggg', '....ppppppp....', '....ppp.ppp....', '...ppp...ppp...', '...pp.....pp...', '..kkk.....kkk..'],
      ],
    },
    // bodybuilder — 13 wide, feet anchor col 5
    brute: {
      walk: [
        ['....hhh......', '...hhhhh.....', '...hsese.....', '...sssss.....', 'sscccccccss..', 'ss.ccccc.ss..', 's..cscsc..s..', 'ss.ccccc.ss..', '...ppppp.....', '...pp.pp.....', '...kk.kk.....'],
        ['....hhh......', '...hhhhh.....', '...hsese.....', '...sssss.....', 'sscccccccss..', 'ss.ccccc.ss..', 's..cscsc..s..', 'ss.ccccc.ss..', '...ppppp.....', '..pp...pp....', '..kk...kk....'],
      ],
      punch: [
        ['....hhh......', '...hhhhh.....', '...hsese.....', '...sssss.....', 'sscccccccsss.', 'ss.cccccsssss', 's..cscsc.....', 'ss.ccccc.....', '...ppppp.....', '..pp...pp....', '..kk...kk....'],
      ],
      // badly hurt: bleeding and running away
      hurt: [
        ['....hhh......', '...hhhhh.....', '...hsxse.....', '...ssmss.....', '.sccxcccss...', 'ss.cccxc.s...', 'x..cxcsc.s...', '...ccccc.....', '...ppppp.....', '..pp...pp....', '.kk.....kk...'],
        ['....hhh......', '...hhhhh.....', '...hsesx.....', '...ssmss.....', '.sccccxcss...', 'ss.cxccc.s...', 's..ccxsc.x...', '...ccccc.....', '...ppppp.....', '...pp.pp.....', '...kk.kk.....'],
      ],
    },
    // giant zombie risen from a bodybuilder — 15x16, feet anchor col 6
    bigzombie: {
      walk: [
        ['.....hhhh......', '....hhhhhh.....', '....hssssss....', '....hsrrsrr....', '....sssssss....', '.....smmms.....', '...cccccccccsss', '..ccccccccccsss', '..cccsccccc....', '..ccccccscc....', '..cccccccc.....', '...pppppp......', '...ppp.ppp.....', '...ppp.ppp.....', '...pp...pp.....', '..kkk...kkk....'],
        ['.....hhhh......', '....hhhhhh.....', '....hssssss....', '....hsrrsrr....', '....sssssss....', '.....smmms.....', '...ccccccccc...', '..cccccccccssss', '..cccscccccssss', '..ccccccscc....', '..cccccccc.....', '...pppppp......', '...ppp.ppp.....', '..ppp...ppp....', '..pp.....pp....', '.kkk.....kkk...'],
      ],
    },
    // acid spitter: swollen green cheeks and an acid sac
    spitter: {
      walk: [
        ['..hhh....', '.hssss...', '.hsrsr...', '..saaa...', '.ccccs...', '.caacc...', '.cscc....', '..ppp....', '..p.p....', '..k.k....'],
        ['..h.h....', '.hssss...', '.hsrsr...', '..saaa.a.', '.ccccs...', '.caacc...', '.ccsc....', '..ppp....', '.p...p...', '.k....k..'],
      ],
    },
    // bloater (suicide bomber): swollen belly full of pus and veins, ready to burst — 11x12, feet col 5
    bomber: {
      walk: [
        ['....hhh....', '...hsssh...', '...srsrs...', '...smmms...', '..sssssss..', '.ssusssVss.', 'ssVsssussss', 'sssusVsssus', '.sssssVsss.', '..ccpppcc..', '..pp...pp..', '..kk...kk..'],
        ['....hhh....', '...hsssh...', '...srsrs...', '...smmms...', '.sssssssss.', 'ssusssVsssu', 'sVsssusssss', 'sssusVsssus', 'ssssssVssss', '.ccpppppcc.', '.pp.....pp.', '.kk.....kk.'],
      ],
    },
    // mansion bodyguard: bodybuilder in a black suit and shades — 13 wide, feet col 5
    guard: {
      walk: [
        ['....hhh......', '...hhhhh.....', '...heeee.....', '...sssss.....', 'cccwwRwwccc..', 'cc.cwRwc.cc..', 'c..ccRcc..c..', 'ss.ccccc.ss..', '...ppppp.....', '...pp.pp.....', '...kk.kk.....'],
        ['....hhh......', '...hhhhh.....', '...heeee.....', '...sssss.....', 'cccwwRwwccc..', 'cc.cwRwc.cc..', 'c..ccRcc..c..', 'ss.ccccc.ss..', '...ppppp.....', '..pp...pp....', '..kk...kk....'],
      ],
      punch: [
        ['....hhh......', '...hhhhh.....', '...heeee.....', '...sssss.....', 'cccwwRwwcccc.', 'cc.cwRwccccss', 'c..ccRcc.....', 'ss.ccccc.....', '...ppppp.....', '..pp...pp....', '..kk...kk....'],
      ],
      hurt: [
        ['....hhh......', '...hhhhh.....', '...hexee.....', '...ssmss.....', '.ccwxRwwcc...', 'cc.cwRxc.c...', 'x..ccRcc.c...', '...cxccc.....', '...ppppp.....', '..pp...pp....', '.kk.....kk...'],
        ['....hhh......', '...hhhhh.....', '...heeex.....', '...ssmss.....', '.ccwwRxwcc...', 'cc.cxRwc.c...', 's..ccRxc.x...', '...ccccc.....', '...ppppp.....', '...pp.pp.....', '...kk.kk.....'],
      ],
    },
    // street dog — 10x7, feet col 4
    dog: {
      walk: [
        ['......c.c.', 'c.....cccc', '.cccccccen', '.cccccccc.', '.cbbbbcc..', '.c.c..c.c.', '.k.k..k.k.'],
        ['......c.c.', '.c....cccc', 'c.ccccccen', '.cccccccc.', '.cbbbbcc..', '..cc...cc.', '..kk...kk.'],
      ],
    },
    // zombie dog: rotten fur, red eye, drooling
    zdog: {
      walk: [
        ['......c.c.', 'c.....cccc', '.cxcccccrn', '.ccccccccm', '.cbbxbcc..', '.c.c..c.c.', '.k.k..k.k.'],
        ['......c.c.', '.c....cccc', 'c.cxccccrn', '.ccccccccm', '.cbbbxcc..', '..cc...cc.', '..kk...kk.'],
      ],
    },
    // blood tank: bloated, 13x12, feet anchor col 6
    tank: {
      walk: [
        ['.....hhh.....', '....hssss....', '....srsrs....', '....smmms....', '..ccccccccc..', '.cccccscccccs', 'ccccsssssccss', 'ccccsssssccc.', '.ccccsssccc..', '..ppppppppp..', '..ppp...ppp..', '..kkk...kkk..'],
        ['.....hhh.....', '....hssss....', '....srsrs....', '....smmms....', '..ccccccccc..', 'scccccsccccc.', 'ssccsssssccc.', '.cccsssssccc.', '.ccccsssccc..', '..ppppppppp..', '.ppp.....ppp.', '.kkk.....kkk.'],
      ],
    },
    // preta (hungry ghost): towering and skeletal — tiny head, needle mouth, long neck, arms down to the knees — 7x22, feet col 3
    preta: {
      walk: [
        ['..hhh..', '.hsssh.', '.hrsrh.', '..sms..', '...s...', '...s...', '...s...', '.sssss.', 's.sds.s', 's.sss.s', 's.sds.s', 's..s..s', 's..s..s', 's.ppp.s', 's.p.p.s', 'd.s.s.d', '..s.s..', '..s.s..', '..s.s..', '..s.s..', '..s.s..', '.ss.ss.'],
        ['..hhh..', '.hsssh.', '.hrsrh.', '..sms..', '...s...', '...s...', '...s...', '.sssss.', 's.sds.s', 's.sss.s', 's.sds.s', '.s.s.s.', '.s.s.s.', '.sppps.', '.dp.pd.', '..s.s..', '..s..s.', '.s...s.', '.s...s.', '.s...s.', '.s...s.', 'ss...ss'],
      ],
    },
    zombie: {
      walk: [
        ['..hhh....', '.hssss...', '.hsrsr...', '..sms....', '.ccccsss.', '.ccbcc...', '.cscc....', '..ppp....', '..p.p....', '..k.k....'],
        ['..h.h....', '.hssss...', '.hsrsr...', '..sms....', '.cccc....', '.ccbcsss.', '.ccsc....', '..ppp....', '.p...p...', '.k....k..'],
      ],
    },
    skel: {
      walk: [
        ['..www....', '.wwwww...', '.wdwdw...', '..www....', '...w.....', '.wwwww...', 'w.www.w..', '..w.w....', '..w.w....', '.ww.ww...'],
        ['..www....', '.wwwww...', '.wdwdw...', '..www....', '...w.....', '.wwwwwww.', '..www....', '..w.w....', '.w...w...', 'ww...ww..'],
      ],
    },
  };

  const AX = { brute: 5, guard: 5, bigzombie: 6, boss: 6, tank: 6, bomber: 5, dog: 4, zdog: 4, preta: 3 };
  const QUAD = { dog: 1, zdog: 1 }; // four-legged: lie on their back instead of rotating

  function paint(rows, colors) {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const c = mk(w, h), x = c.getContext('2d');
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        const col = colors[rows[j][i]];
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i, j, 1, 1);
      }
    }
    return c;
  }
  function flip(c) {
    const f = mk(c.width, c.height), x = f.getContext('2d');
    x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0);
    return f;
  }
  function white(c, col = '#ffffff') { // solid silhouette (hit flash / rage glow)
    const f = mk(c.width, c.height), x = f.getContext('2d');
    x.drawImage(c, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    return f;
  }
  function flipV(c) {
    const f = mk(c.width, c.height), x = f.getContext('2d');
    x.translate(0, c.height); x.scale(1, -1); x.drawImage(c, 0, 0);
    return f;
  }
  function rot(c) { // 90° clockwise — a body lying on the ground
    const r = mk(c.height, c.width), x = r.getContext('2d');
    x.translate(c.height, 0); x.rotate(Math.PI / 2); x.drawImage(c, 0, 0);
    return r;
  }

  const cache = new Map();
  function get(type, pal) {
    const key = type + '|' + (pal ? [pal.h, pal.s, pal.c, pal.b, pal.p].join(',') : '');
    let s = cache.get(key);
    if (s) return s;
    const colors = Object.assign({}, BASE, pal || {});
    const anims = {};
    // variants are built on first use only — most people never flash, rage or lie down,
    // and every person has a unique palette, so eager creation made level starts slow
    const lazy = (obj, key, fn) => Object.defineProperty(obj, key, {
      configurable: true, get() { const v = fn(); Object.defineProperty(obj, key, { value: v }); return v; },
    });
    for (const name in T[type]) {
      const a = { r: T[type][name].map((rows) => paint(rows, colors)) };
      lazy(a, 'l', () => a.r.map(flip));
      lazy(a, 'wr', () => a.r.map((f) => white(f)));
      lazy(a, 'wl', () => a.l.map((f) => white(f)));
      lazy(a, 'rr', () => a.r.map((f) => white(f, '#ff2a1a'))); // rage outline
      lazy(a, 'rl', () => a.l.map((f) => white(f, '#ff2a1a')));
      anims[name] = a;
    }
    const f0 = anims.walk.r[0];
    s = { w: f0.width, h: f0.height, ax: AX[type] || 3, anims };
    lazy(s, 'lying', () => (QUAD[type] ? flipV(f0) : rot(f0)));
    cache.set(key, s);
    return s;
  }

  // ---- UI icons (8x8) -----------------------------------------------------
  const ICONS = {
    blood: { pal: { R: '#e8383f', r: '#a3121a', w: '#ffc4c4' }, rows: ['...R....', '...R....', '..RRr...', '.RRRrr..', '.RwRrr..', '.RRrrr..', '..rrr...', '........'] },
    brain: { pal: { p: '#e57fa8', P: '#a8466f', l: '#ffc8df' }, rows: ['..pppp..', '.plpPpp.', 'pPplpPpp', 'ppPppPlp', 'plpPppPp', '.pPplpp.', '..pp.Pp.', '........'] },
    bone: { pal: { w: '#f2ead4', d: '#a99c7c' }, rows: ['.ww.....', 'wwwd....', '.wwwd...', '..wwwd..', '...wwwd.', '....wwwd', '.....dww', '......w.'] },
    energy: { pal: { Y: '#e6d8ff', y: '#9a6bff' }, rows: ['....YY..', '...Yy...', '..Yy....', '.Yyyyy..', '...yY...', '..yY....', '.yY.....', '.y......'] },
    skull: { pal: { w: '#e8e2d0', d: '#161616', g: '#9fc76a' }, rows: ['..www...', '.wwwww..', 'wwwwwww.', 'wddwddw.', 'wwwdwww.', '.wwwww..', '.w.w.w..', '........'] },
    human: { pal: { s: '#f1c27d', c: '#4c7bd9', p: '#2e3a59', h: '#5a3825' }, rows: ['...hh...', '..hssh..', '...ss...', '..cccc..', '.c.cc.c.', '...pp...', '...pp...', '..p..p..'] },
    frenzy: { pal: { r: '#ff5050', R: '#9e1414' }, rows: ['r..r..r.', 'r..r..r.', '.r..r..r', '.r..r..r', '.R..R..R', '..R..R..', '..R..R..', '........'] },
    plague: { pal: { g: '#9be354', G: '#4f8a2a' }, rows: ['...gg...', '..gggg..', '.ggGggg.', 'gggggGgg', 'gGgggggg', '.gggGgg.', '..G..G..', '.G..G...'] },
    raise: { pal: { z: '#8fb36a', d: '#5a3f28', D: '#3a2818' }, rows: ['..z.z...', '..zzz.z.', '..zzzzz.', '..zzzz..', '...zz...', '...zz...', 'dddddddd', '.DD.DDD.'] },
    soul: { pal: { p: '#b48cff', P: '#6a3ad0', w: '#f0e6ff' }, rows: ['...p....', '..pp.p..', '..ppp...', '.ppwpp..', '.pwwwpp.', '.ppwppP.', '..pPPP..', '...PP...'] },
    trophy: { pal: { y: '#f0c830', Y: '#b08a18', w: '#fff4b0' }, rows: ['yyyyyyyy', 'ywyyyyYy', '.yyyyyY.', '..yyyY..', '...yY...', '...yY...', '..yyyY..', '.YYYYYY.'] },
    zombie: { pal: { s: '#7fa35a', r: '#ff3a3a', c: '#6b5a4a', h: '#3a2a1a' }, rows: ['..hhh...', '.hssss..', '.srsr...', '..ss....', '.ccccss.', '.cccc...', '..c.c...', '..c.c...'] },
    spit: { pal: { s: '#7fa35a', a: '#8cff3a', c: '#4a5a6b', r: '#ff3a3a' }, rows: ['.ssss...', '.srsr...', '.saaa.a.', '..ss..a.', '.cacc...', '.cccc.a.', '..c.c...', '..c.c...'] },
    bomb: { pal: { s: '#8fae6a', r: '#ff3a3a', u: '#dcd65a', V: '#8a2a3a', p: '#3b3b3b' }, rows: ['...ss...', '..srsr..', '.ssuss..', 'ssVssus.', 'susssVs.', '.ssuss..', '..p.p...', '........'] },
    dog: { pal: { c: '#b87a3a', b: '#e8c890', e: '#1a1a1a', n: '#1a1a1a' }, rows: ['.....c.c', 'c....ccc', '.cccccen', '.ccccccc', '.cbbbcc.', '.c.c.c.c', '........', '........'] },
    sun: { pal: { y: '#ffd23a', o: '#ff9a2a' }, rows: ['...y....', '.y.y.y..', '..ooo...', 'yyoooyy.', '..ooo...', '.y.y.y..', '...y....', '........'] },
    snow: { pal: { w: '#e8f4ff', b: '#9ac8f0' }, rows: ['...w....', '.w.w.w..', '..wbw...', 'wwbwbww.', '..wbw...', '.w.w.w..', '...w....', '........'] },
    flood: { pal: { b: '#3a8ad0', w: '#bfe4ff' }, rows: ['........', '..ww....', '.wbbw..w', 'wbbbbwwb', 'bbbbbbbb', 'bwbbbwbb', 'bbbbbbbb', '........'] },
    clear: { pal: { y: '#ffd23a', w: '#e8eef4' }, rows: ['..yy....', '.yyyy...', '.yyww...', '..wwwww.', '.wwwwwww', '.wwwwwww', '........', '........'] },
    tank: { pal: { s: '#6d9150', c: '#5c3a3a', r: '#ff3a3a' }, rows: ['..ssss..', '..rssr..', '.cccccc.', 'ccsssscc', 'ccsssscc', '.cssssc.', '.cc..cc.', '.cc..cc.'] },
    preta: { pal: { h: '#d8e8ff', s: '#93a8c0', d: '#40506a', r: '#ff3a3a', p: '#5a5a6a' }, rows: ['...h....', '..srs...', '...s....', '..sss...', '.s.d.s..', '.s.p.s..', '..s.s...', '..s.s...'] },
    note: { pal: { w: '#e8e0f0' }, rows: ['...wwwww', '...w...w', '...w...w', '...w...w', '.www.www', 'wwww.www', 'www.....', '........'] },
    crown: { pal: { y: '#f0c830', Y: '#b08a18', r: '#e03030' }, rows: ['........', 'y..y..y.', 'yy.yy.yy', 'yyyyyyyy', 'yryyyryy', 'yyyyyyyy', 'YYYYYYYY', '........'] },
    house: { pal: { r: '#c0503a', R: '#8a3222', w: '#e0d0b0', d: '#5a3a22', y: '#f7e07a' }, rows: ['...rr...', '..rRRr..', '.rRRRRr.', 'rRRRRRRr', '.wwwwww.', '.wywdww.', '.wwwdww.', '.wwwdww.'] },
    gear: { pal: { g: '#b9aec2', d: '#6c6275' }, rows: ['...gg...', '.g.gg.g.', '..gggg..', 'gggddggg', 'gggddggg', '..gggg..', '.g.gg.g.', '...gg...'] },
    // routes & random events
    lantern: { pal: { r: '#e03030', y: '#ffd23a', o: '#ff8a2a' }, rows: ['...yy...', '..rrrr..', '.rryyrr.', '.ryooyr.', '.ryooyr.', '.rryyrr.', '..rrrr..', '...yy...'] },
    moon: { pal: { r: '#e03a3a', R: '#8a1a1a', w: '#ff9a8a' }, rows: ['..rrrr..', '.rwrrrr.', 'rwrrRrrr', 'rrrrrrRr', 'rrRrrrrr', 'rrrrRrrr', '.rrrrrr.', '..rrrr..'] },
    bulb: { pal: { w: '#8a8a9a', y: '#2a2a3a', g: '#6a6a7a', d: '#3a3a4a', r: '#e04040' }, rows: ['r.wwww.r', '.rwyywr.', '.wryrrw.', '.wyrryw.', '..ryyr..', '.r.gg.r.', 'r..dd..r', '...gg...'] },
    crate: { pal: { b: '#b07a2a', B: '#6a4a1a', w: '#f0f0f0', r: '#e03030' }, rows: ['.wwwwww.', 'w.w..w.w', '.w.ww.w.', '...ww...', 'BBBBBBBB', 'BbbrrbbB', 'BbbrrbbB', 'BBBBBBBB'] },
    helmet: { pal: { g: '#6d7b3a', G: '#3f4a24', s: '#f1c27d', e: '#1a1a1a' }, rows: ['........', '..gggg..', '.gggGgg.', 'gggggggg', 'GGGGGGGG', '.ssssss.', '.sesses.', '..ssss..'] },
    badge: { pal: { y: '#f0c830', Y: '#b08a18', b: '#2f4fa8' }, rows: ['...yy...', '.yyyyyy.', 'yybbbbyy', '.ybyybY.', '.ybbbbY.', '..yyyY..', '...YY...', '........'] },
    tent: { pal: { r: '#e03030', w: '#f0f0f0', b: '#6a4a2a', y: '#f0c830' }, rows: ['...rr...', '..rwwr..', '.rwrrwr.', 'rwrwwrwr', 'b......b', 'b.yy...b', 'b.yy...b', 'b......b'] },
    temple: { pal: { o: '#e08a2a', y: '#f0c830', w: '#f4efe4', r: '#b8402a' }, rows: ['...y....', '...o....', '..ooo...', '.rrrrr..', 'rrrrrrr.', '.wwwww..', '.w.w.w..', 'wwwwwww.'] },
    quiet: { pal: { g: '#6bbf59', G: '#3d8c33', t: '#6a4a28', w: '#e8e0d0', r: '#b8502a' }, rows: ['..gg....', '.gGgg...', '.gggg.r.', '..t..rrr', '..t..www', '..t..www', 'gggggggg', '........'] },
  };
  const iconCache = {};
  function icon(name) {
    if (iconCache[name]) return iconCache[name];
    const d = ICONS[name];
    const url = paint(d.rows, d.pal).toDataURL();
    iconCache[name] = url;
    return url;
  }
  function iconCanvas(name) {
    const d = ICONS[name];
    return paint(d.rows, d.pal);
  }

  // ---- 3x5 bitmap font for floating numbers --------------------------------
  const FONT = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
    '+': '000010111010000', '-': '000000111000000', '.': '000000000000010', '!': '010010010000010',
    K: '101101110101101', M: '101111111101101', B: '110101110101110', T: '111010010010010', Q: '111101101111001',
    A: '010101111101101', X: '101101010101101', S: '111100111001111', P: '111101111100100', O: '111101101101111',
    C: '111100100100111', N: '110101101101101', D: '110101101101110', I: '111010010010111', E: '111100111100111',
  };
  function textWidth(str) { return str.length * 4 - 1; }
  function drawText(ctx, str, x, y, col) {
    str = String(str).toUpperCase();
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass ? col : '#000';
      const o = pass ? 0 : 1;
      for (let i = 0; i < str.length; i++) {
        const f = FONT[str[i]];
        if (!f) continue;
        for (let p = 0; p < 15; p++) if (f[p] === '1') ctx.fillRect(x + i * 4 + (p % 3) + o, y + ((p / 3) | 0) + o, 1, 1);
      }
    }
  }

  return { mk, get, icon, iconCanvas, drawText, textWidth };
})();
