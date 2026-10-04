import './ui.css';
import { POWER_INFO } from '../render/world/pickups';
import type { RunState } from '../sim/run';
import type { SaveData } from '../sim/save';
import type { PowerKind, TimedPower } from '../sim/types';
import { POWER_TIME } from '../sim/powerups';

/**
 * 介面（DOM 疊在 WebGL 畫面上）：標題、HUD、橫幅、暫停、結算（兵糧丸復活）、操作說明。
 * 介面只負責顯示與按鈕，遊戲流程由 game.ts 透過回呼控制。
 */

/** 介面按鈕的回呼 */
export interface UiHandlers {
  onStart(): void;
  onResume(): void;
  onPause(): void;
  onHome(): void;
  onRevive(): void;
  onSkipRevive(): void;
  onRetry(): void;
  onToggleMute(): void;
  onBoard(): void;
  /** 點「爆」按鈕：擲起爆符苦無 */
  onKunai(): void;
}

/** HUD 上顯示的能力（順序固定） */
const HUD_POWERS: TimedPower[] = ['rasengan', 'toad', 'chakra', 'magnet', 'clones', 'board'];

/** 能力 → 道具資訊（卷軸滑板不是場上道具，另外定義） */
function powerInfo(k: TimedPower): { kanji: string; color: string; name: string } {
  if (k === 'board') return { kanji: '板', color: '#b8282a', name: '通靈卷軸滑板' };
  return POWER_INFO[k as PowerKind];
}

/** 建立元素的小工具 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** 數字加千分位 */
function fmt(n: number): string {
  return Math.floor(n).toLocaleString('zh-TW');
}

export class Ui {
  readonly root: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly scoreEl: HTMLSpanElement;
  private readonly ryoEl: HTMLSpanElement;
  private readonly multEl: HTMLDivElement;
  private readonly powersEl: HTMLDivElement;
  private readonly powerRows = new Map<TimedPower, { row: HTMLDivElement; bar: HTMLElement; label: HTMLElement }>();
  private readonly boardBtn: HTMLButtonElement;
  private readonly boardCount: HTMLSpanElement;
  /** 左下角的手裏劍數量 */
  private readonly shurikenChip: HTMLDivElement;
  private readonly shurikenCount: HTMLElement;
  /** 左下角的替身木頭（持有時顯示） */
  private readonly subChip: HTMLDivElement;
  /** 右下角卷軸滑板上方的「爆」按鈕（持有起爆符苦無時顯示） */
  private readonly kunaiBtn: HTMLButtonElement;
  private readonly kunaiCount: HTMLSpanElement;
  private readonly dangerEl: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly howto: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly over: HTMLElement;
  private readonly loading: HTMLDivElement;
  private bannerTimer = 0;
  private reviveTimer = 0;
  private reviveTotal = 1;

  constructor(
    container: HTMLElement,
    h: UiHandlers,
  ) {
    this.root = el('div', 'ui');
    container.appendChild(this.root);

    // ── HUD ──
    this.hud = el('div', 'hud');
    this.hud.hidden = true;
    const pause = el('button', 'pause-btn', '<span>Ⅱ</span>');
    pause.setAttribute('aria-label', '暫停');
    pause.addEventListener('click', () => h.onPause());
    const scoreBox = el('div', 'score-box');
    this.scoreEl = el('span', 'score', '0');
    const ryoRow = el('div', 'ryo-row', '<i class="ryo-icon"></i>');
    this.ryoEl = el('span', 'ryo', '0');
    ryoRow.appendChild(this.ryoEl);
    this.multEl = el('div', 'mult', '×2');
    this.multEl.hidden = true;
    scoreBox.append(this.scoreEl, ryoRow, this.multEl);
    this.powersEl = el('div', 'powers');
    for (const k of HUD_POWERS) {
      const info = powerInfo(k);
      const row = el('div', 'pw');
      row.hidden = true;
      row.innerHTML = `<b style="background:${info.color}">${info.kanji}</b><span><em>${info.name}</em><i><s></s></i></span>`;
      this.powersEl.appendChild(row);
      this.powerRows.set(k, { row, bar: row.querySelector('s')!, label: row.querySelector('em')! });
    }
    this.boardBtn = el('button', 'board-btn', '<b>板</b>');
    this.boardBtn.setAttribute('aria-label', '通靈卷軸滑板');
    this.boardCount = el('span', 'count', '0');
    this.boardBtn.append(this.boardCount, el('small', 'hint', '<span class="kb">Space</span>'));
    this.boardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      h.onBoard();
    });
    // 起爆符苦無按鈕：持有時才出現，疊在卷軸滑板按鈕上方
    this.kunaiBtn = el('button', 'kunai-btn', '<b>爆</b>');
    this.kunaiBtn.setAttribute('aria-label', '起爆符苦無');
    this.kunaiCount = el('span', 'count', '0');
    this.kunaiBtn.append(this.kunaiCount, el('small', 'hint', '<span class="kb">G</span>'));
    this.kunaiBtn.hidden = true;
    this.kunaiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      h.onKunai();
    });
    // 左下角：手裏劍數量與替身木頭（純顯示，不擋觸控）
    const arms = el('div', 'arms');
    this.shurikenChip = el('div', 'arm shuriken-chip', '<i class="star"></i>');
    this.shurikenCount = el('b', 'n', '3');
    this.shurikenChip.append(this.shurikenCount, el('small', 'hint', '<span class="kb">F</span><span class="tc">點畫面</span>'));
    this.subChip = el('div', 'arm sub-chip', '<b class="kanji">替</b><small>替身木頭</small>');
    this.subChip.hidden = true;
    arms.append(this.shurikenChip, this.subChip);
    this.dangerEl = el('div', 'danger');
    this.dangerEl.hidden = true;
    this.hud.append(this.dangerEl, pause, scoreBox, this.powersEl, arms, this.kunaiBtn, this.boardBtn);
    this.root.appendChild(this.hud);

    this.banner = el('div', 'banner');
    this.root.appendChild(this.banner);

    // ── 標題 ──
    this.title = el('section', 'screen title-screen');
    this.title.innerHTML = `
      <div class="logo">
        <div class="logo-en">NINJA<br>SURFERS</div>
        <div class="logo-zh"><span>忍者跑酷</span></div>
      </div>
      <div class="stats">
        <div><small>最高分</small><b class="best">0</b></div>
        <div><small>兩</small><b class="bank">0</b></div>
        <div><small>卷軸滑板</small><b class="boards">0</b></div>
        <div><small>兵糧丸</small><b class="pills">0</b></div>
      </div>
      <button class="big start">開始逃跑！</button>
      <div class="row">
        <button class="howto-btn">操作說明</button>
        <button class="mute-btn">音效：開</button>
      </div>
      <p class="story">在刻臉岩壁上塗鴉被發現了……快逃！</p>`;
    this.title.querySelector('.start')!.addEventListener('click', () => h.onStart());
    this.title.querySelector('.howto-btn')!.addEventListener('click', () => this.showHowto(true));
    this.title.querySelector('.mute-btn')!.addEventListener('click', () => h.onToggleMute());
    this.root.appendChild(this.title);

    // ── 操作說明 ──
    this.howto = el('section', 'screen howto');
    this.howto.hidden = true;
    this.howto.innerHTML = `
      <h2>操作說明</h2>
      <table>
        <tr><th>換線</th><td><span class="kb">← → ／ A D</span><span class="tc">左右滑</span></td></tr>
        <tr><th>跳</th><td><span class="kb">↑ ／ W</span><span class="tc">上滑</span></td></tr>
        <tr><th>滾（空中＝急降）</th><td><span class="kb">↓ ／ S</span><span class="tc">下滑</span></td></tr>
        <tr><th>手裏劍</th><td><span class="kb">F</span><span class="tc">點一下畫面</span></td></tr>
        <tr><th>起爆符苦無</th><td><span class="kb">G</span><span class="tc">「爆」按鈕</span></td></tr>
        <tr><th>瞬身術</th><td><span class="kb">同方向快按兩下</span><span class="tc">同方向快滑兩下</span></td></tr>
        <tr><th>通靈卷軸滑板</th><td><span class="kb">Space</span><span class="tc">「板」按鈕</span></td></tr>
        <tr><th>暫停</th><td><span class="kb">Esc ／ P</span><span class="tc">左上角按鈕</span></td></tr>
      </table>
      <ul class="powers-help">
        <li><b style="background:#4f6475">劍</b>手裏劍 +3：打碎前方的低欄、橫樑、擋牆（列車打不壞），最多 9 支</li>
        <li><b style="background:#c21d3c">爆</b>起爆符苦無：炸掉同一車道前方 30 m 的障礙，連列車都炸得掉</li>
        <li><b style="background:#15b3d6">螺</b>螺旋丸：3 秒衝刺，撞到什麼都撞碎</li>
        <li><b style="background:#8a5a2b">替</b>替身木頭：擋下一次倒下或被抓</li>
        <li><b style="background:#e4572a">蛙</b>通靈術・巨蛤蟆：騎蛤蟆在空中大跳，無敵</li>
        <li><b style="background:#2f7de1">查</b>查克拉附著：跳得更高；正面撞上列車或擋牆會直接跑上去</li>
        <li><b style="background:#7a4bd6">引</b>萬象天引：把附近的兩全部吸過來</li>
        <li><b style="background:#f09a17">影</b>多重影分身：分數 ×2，每個分身幫你擋一次低欄、橫樑或擋牆</li>
        <li><b style="background:#b8282a">秘</b>秘傳卷軸：隨機獎勵</li>
        <li><b style="background:#3d9a4a">丸</b>兵糧丸：被抓之後可以復活</li>
      </ul>
      <p>正面撞上障礙就會倒下；側面擦撞會踉蹌，追捕者會追上來，短時間內再踉蹌一次就被抓。瞬身術：0.25 秒內往同一個方向換線兩次，會瞬間移到最遠的安全車道（冷卻 1.2 秒）。</p>
      <button class="big close">知道了</button>`;
    this.howto.querySelector('.close')!.addEventListener('click', () => this.showHowto(false));
    this.root.appendChild(this.howto);

    // ── 暫停 ──
    this.pauseScreen = el('section', 'screen pause-screen');
    this.pauseScreen.hidden = true;
    this.pauseScreen.innerHTML = `<h2>暫停</h2><button class="big resume">繼續</button>
      <div class="row"><button class="home">回標題</button><button class="mute-btn">音效：開</button></div>`;
    this.pauseScreen.querySelector('.resume')!.addEventListener('click', () => h.onResume());
    this.pauseScreen.querySelector('.home')!.addEventListener('click', () => h.onHome());
    this.pauseScreen.querySelector('.mute-btn')!.addEventListener('click', () => h.onToggleMute());
    this.root.appendChild(this.pauseScreen);

    // ── 結算 ──
    this.over = el('section', 'screen over-screen');
    this.over.hidden = true;
    this.over.innerHTML = `
      <h2 class="headline"></h2>
      <p class="quote"></p>
      <div class="revive" hidden>
        <button class="big revive-btn"></button>
        <div class="revive-bar"><i></i></div>
        <button class="skip">不用了</button>
      </div>
      <div class="result" hidden>
        <div class="final"><small>分數</small><b class="final-score">0</b><em class="new-best" hidden>新紀錄！</em></div>
        <div class="row stats-row"><span>兩 +<b class="final-ryo">0</b></span><span>最高分 <b class="final-best">0</b></span></div>
        <button class="big retry">再跑一次</button>
        <button class="home">回標題</button>
      </div>`;
    this.over.querySelector('.revive-btn')!.addEventListener('click', () => h.onRevive());
    this.over.querySelector('.skip')!.addEventListener('click', () => h.onSkipRevive());
    this.over.querySelector('.retry')!.addEventListener('click', () => h.onRetry());
    this.over.querySelector('.home')!.addEventListener('click', () => h.onHome());
    this.root.appendChild(this.over);

    this.loading = el('div', 'loading', '<div class="spinner"></div><p>忍者準備中……</p>');
    this.root.appendChild(this.loading);
  }

  /** 更新載入畫面的文字（進度） */
  setLoadingText(text: string): void {
    const p = this.loading.querySelector('p');
    if (p) p.textContent = text;
  }

  /** 載入完成：拿掉載入畫面 */
  ready(): void {
    this.loading.remove();
  }

  /** 顯示標題畫面（帶入存檔數字） */
  showTitle(save: SaveData): void {
    this.hideAll();
    this.title.hidden = false;
    const q = (s: string) => this.title.querySelector(s)!;
    q('.best').textContent = fmt(save.best);
    q('.bank').textContent = fmt(save.ryo);
    q('.boards').textContent = String(save.boards);
    q('.pills').textContent = String(save.pills);
  }

  /** 顯示或關閉操作說明 */
  showHowto(on: boolean): void {
    this.howto.hidden = !on;
  }

  /** 進入奔跑畫面 */
  showHud(): void {
    this.hideAll();
    this.hud.hidden = false;
  }

  /** 暫停畫面 */
  showPause(on: boolean): void {
    this.pauseScreen.hidden = !on;
  }

  /** 更新靜音按鈕文字 */
  setMuted(muted: boolean): void {
    for (const b of this.root.querySelectorAll('.mute-btn')) b.textContent = `音效：${muted ? '關' : '開'}`;
  }

  /** 每幀更新 HUD */
  updateHud(run: RunState): void {
    this.scoreEl.textContent = fmt(run.score);
    this.ryoEl.textContent = fmt(run.coins);
    this.multEl.hidden = run.power.clones <= 0;
    for (const k of HUD_POWERS) {
      const r = this.powerRows.get(k)!;
      const left = run.power[k];
      r.row.hidden = left <= 0;
      if (left > 0) r.bar.style.width = `${Math.min(100, (left / POWER_TIME[k]) * 100)}%`;
    }
    // 影分身：名稱後面標出還剩幾個分身可以擋
    const clonesLabel = `${POWER_INFO.clones.name} ×${run.clonesLeft}`;
    const cl = this.powerRows.get('clones')!.label;
    if (cl.textContent !== clonesLabel) cl.textContent = clonesLabel;
    this.boardCount.textContent = String(run.boards);
    this.boardBtn.classList.toggle('empty', run.boards <= 0 || run.power.board > 0);
    this.shurikenCount.textContent = String(run.shuriken);
    this.shurikenChip.classList.toggle('empty', run.shuriken <= 0);
    this.subChip.hidden = run.subs <= 0;
    this.kunaiBtn.hidden = run.kunai <= 0;
    this.kunaiCount.textContent = String(run.kunai);
    this.dangerEl.hidden = run.chaser.danger <= 0;
  }

  /** 中央橫幅（自動消失） */
  flash(text: string, kind: 'info' | 'power' | 'warn' | 'biome' = 'info', seconds = 1.8): void {
    this.banner.textContent = text;
    this.banner.className = `banner show ${kind}`;
    this.bannerTimer = seconds;
  }

  /**
   * 結算第一步：倒下的標題與台詞；有兵糧丸就顯示復活按鈕與倒數。
   * @param cost 復活要花的兵糧丸（null = 不能復活）
   */
  showGameOver(headline: string, quote: string, cost: number | null, pills: number): void {
    this.hideAll();
    this.over.hidden = false;
    this.over.querySelector('.headline')!.textContent = headline;
    this.over.querySelector('.quote')!.textContent = quote;
    const revive = this.over.querySelector('.revive') as HTMLElement;
    const result = this.over.querySelector('.result') as HTMLElement;
    result.hidden = true;
    if (cost !== null) {
      revive.hidden = false;
      this.over.querySelector('.revive-btn')!.innerHTML = `吃兵糧丸復活 <small>（${cost} 顆，剩 ${pills} 顆）</small>`;
      this.reviveTotal = 6;
      this.reviveTimer = 6;
    } else {
      revive.hidden = true;
      this.reviveTimer = 0;
    }
  }

  /** 結算第二步：分數 */
  showResult(score: number, ryo: number, best: number, newBest: boolean): void {
    this.over.hidden = false;
    (this.over.querySelector('.revive') as HTMLElement).hidden = true;
    (this.over.querySelector('.result') as HTMLElement).hidden = false;
    this.over.querySelector('.final-score')!.textContent = fmt(score);
    this.over.querySelector('.final-ryo')!.textContent = fmt(ryo);
    this.over.querySelector('.final-best')!.textContent = fmt(best);
    (this.over.querySelector('.new-best') as HTMLElement).hidden = !newBest;
    this.reviveTimer = 0;
  }

  /**
   * 每幀推進介面計時（橫幅消失、復活倒數）。
   * @returns 復活倒數剛好結束時回傳 true
   */
  tick(dt: number): boolean {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.reviveTimer > 0) {
      this.reviveTimer -= dt;
      const bar = this.over.querySelector('.revive-bar i') as HTMLElement;
      bar.style.width = `${Math.max(0, (this.reviveTimer / this.reviveTotal) * 100)}%`;
      if (this.reviveTimer <= 0) return true;
    }
    return false;
  }

  /** 全部畫面藏起來 */
  private hideAll(): void {
    this.hud.hidden = true;
    this.title.hidden = true;
    this.howto.hidden = true;
    this.pauseScreen.hidden = true;
    this.over.hidden = true;
  }
}
