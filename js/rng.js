'use strict';

/* =========================================================
   Seeded RNG
========================================================= */
class SeededRandom {
  constructor(seed){ this.seed=seed; }
  next(){ this.seed=(this.seed*1103515245+12345)&0x7fffffff; return this.seed/0x7fffffff; }
  nextInt(max){ return Math.floor(this.next()*max); }
}
