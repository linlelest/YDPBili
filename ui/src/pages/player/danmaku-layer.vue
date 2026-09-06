<!--
 Copyright (C) 2025 Bilibili miniapp contributors

 This file is part of miniapp.

 miniapp is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 miniapp is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with miniapp. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
    <div class="danmaku-layer">
        <div
            v-for="item in active"
            :key="item.id"
            :class="item.kind === 'top' ? 'dm-top' : 'dm-scroll'"
            :style="item.kind === 'top' ? {} : { top: item.lane + 'px', left: item.x + 'px' }"
        >
            <text
                class="dm-text"
                :style="{ color: item.color, 'font-size': fontSize + 'px' }"
            >{{ item.text }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped>
.danmaku-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 280px;
    height: 158px;
}

.dm-scroll {
    position: absolute;
    left: 280px;
}

.dm-top {
    position: absolute;
    top: 4px;
    left: 0;
    width: 280px;
    align-items: center;
}

.dm-text {
    lines: 1;
    text-overflow: ellipsis;
    color: #ffffff;
}
</style>

<script>
/**
 * danmaku-layer.vue —— 弹幕覆盖层（页内组件，player 专用）
 *
 * 数据流：
 * - items：全量弹幕（getDanmaku 输出，按 progressMs 升序）；
 * - posMs：父页面 500ms 进度轮询透传；watch 检测跳变（seek/回退）→ 清理在屏并重定位游标；
 * - 游标推进：每次 posMs 同步消费 [pos, pos+800ms] 窗口新弹幕入列（同屏 ≤5 保护）；
 * - 渲染：内部 100ms setInterval 节流驱动——滚动弹幕（mode 1-3）按视频时钟
 *   外推 x 坐标（280px / 10s ≈ 28px/s，暂停冻结），顶部弹幕（mode 5）居中 3s；
 * - resetKey：cid 变化等场景硬重置。
 */

const STAGE_WIDTH = 280;
const SCROLL_SPEED = STAGE_WIDTH / 10; // px/s：~10s 横穿
const SCROLL_LANES = [6, 32, 58];
const TOP_DURATION_MS = 3000;
const WINDOW_MS = 800;
const PASSED_TOLERANCE_MS = 300;
const JUMP_RESET_MS = 1200;
const MAX_ONSCREEN = 5;
const TICK_MS = 100;

function estimateTextWidth(text, fontSize) {
  const s = String(text || '');
  let units = 0;
  for (let i = 0; i < s.length; i++) {
    units += s.charCodeAt(i) > 0xff ? 1 : 0.55;
  }
  return Math.max(1, Math.ceil(units * fontSize));
}

function lowerBound(items, posMs) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].progressMs < posMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export default {
  name: 'danmaku-layer',
  props: {
    items: { type: Array, default: function () { return []; } },
    posMs: { type: Number, default: 0 },
    playing: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    fontSize: { type: Number, default: 25 },
    resetKey: { type: Number, default: 0 },
  },
  data() {
    return { active: [] };
  },
  created() {
    this.cursor = 0;
    this.lastPos = 0;
    this.lastClock = Date.now();
    this.lastPlaying = false;
    this.seq = 0;
    this.synced = false;
  },
  mounted() {
    this.startTicker();
  },
  beforeDestroy() {
    this.stopTicker();
  },
  watch: {
    posMs: {
      handler(val) {
        this.onPosChange(Number(val) || 0);
      },
      immediate: true,
    },
    playing(val) {
      this.lastPlaying = !!val;
    },
    enabled(val) {
      if (!val) {
        this.active = [];
      } else {
        this.lastClock = Date.now();
      }
    },
    items() {
      this.hardReset(this.lastPos);
    },
    resetKey() {
      this.hardReset(this.lastPos);
    },
  },
  methods: {
    startTicker() {
      if (this.tickerId) return;
      const self = this;
      const tick = function () {
        self.tick();
      };
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.setInterval === 'function') {
        this.tickerId = pageObj.setInterval(tick, TICK_MS);
        this.tickerKind = 'page';
      } else {
        this.tickerId = setInterval(tick, TICK_MS);
        this.tickerKind = 'global';
      }
    },
    stopTicker() {
      if (!this.tickerId) return;
      if (this.tickerKind === 'page') {
        const pageObj = this.$page;
        if (pageObj && typeof pageObj.clearInterval === 'function') {
          pageObj.clearInterval(this.tickerId);
        }
      } else {
        clearInterval(this.tickerId);
      }
      this.tickerId = null;
      this.tickerKind = '';
    },
    /** 视频时钟（ms）：暂停时冻结在 lastPos。 */
    currentVideoMs() {
      const now = Date.now();
      return this.lastPlaying ? this.lastPos + (now - this.lastClock) : this.lastPos;
    },
    onPosChange(pos) {
      const now = Date.now();
      if (this.synced && (pos < this.lastPos - 60 || pos > this.lastPos + JUMP_RESET_MS)) {
        this.hardReset(pos);
        return;
      }
      this.synced = true;
      this.lastPos = pos;
      this.lastClock = now;
      this.lastPlaying = this.playing;
      this.consumeWindow(pos);
    },
    /** seek / 数据重置：清空在屏弹幕并将游标重定位到 pos。 */
    hardReset(pos) {
      this.active = [];
      this.lastPos = pos;
      this.lastClock = Date.now();
      this.cursor = lowerBound(this.items, Math.max(0, pos - PASSED_TOLERANCE_MS));
      this.consumeWindow(pos);
    },
    /** 消费 [pos, pos+WINDOW_MS] 窗口：游标推进 + 限流入列。 */
    consumeWindow(pos) {
      const list = this.items || [];
      const horizon = pos + WINDOW_MS;
      while (this.cursor < list.length && list[this.cursor].progressMs <= horizon) {
        const it = list[this.cursor++];
        if (!this.enabled) continue;
        if (it.progressMs < pos - PASSED_TOLERANCE_MS) continue;
        if (this.active.length >= MAX_ONSCREEN) continue;
        this.spawn(it);
      }
    },
    spawn(it) {
      this.seq += 1;
      const isTop = Number(it.mode) === 5;
      const lane = isTop ? 0 : SCROLL_LANES[Math.floor(Math.random() * SCROLL_LANES.length)];
      this.active.push({
        id: this.seq,
        text: String(it.content || ''),
        color: this.normalizeColor(it.color),
        kind: isTop ? 'top' : 'scroll',
        lane,
        spawnAtMs: this.currentVideoMs(),
        estWidth: estimateTextWidth(it.content, this.fontSize || 25),
        x: STAGE_WIDTH,
      });
    },
    normalizeColor(color) {
      const n = Number(color);
      const v = isFinite(n) && n > 0 ? Math.floor(n) & 0xffffff : 0xffffff;
      return '#' + ('000000' + v.toString(16)).slice(-6);
    },
    tick() {
      if (!this.active.length) return;
      const curMs = this.currentVideoMs();
      const keep = [];
      for (let i = 0; i < this.active.length; i++) {
        const item = this.active[i];
        const elapsedMs = curMs - item.spawnAtMs;
        if (item.kind === 'top') {
          if (elapsedMs <= TOP_DURATION_MS) keep.push(item);
          continue;
        }
        const x = STAGE_WIDTH - (elapsedMs / 1000) * SCROLL_SPEED;
        item.x = x;
        if (x > -item.estWidth) keep.push(item);
      }
      this.active = keep;
    },
  },
};
</script>
