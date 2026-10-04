/**
 * iPhone／iPad 的音訊工作階段處理。
 *
 * iOS Safari 預設把 Web Audio 歸在「ambient」類：側邊的響鈴／靜音鍵開在靜音時，網頁遊戲就完全沒聲音。
 * - iOS 16.4+：設定 `navigator.audioSession.type = 'playback'`，改走媒體播放，不受靜音鍵影響（要在建立 AudioContext 之前設）。
 * - 更舊的 iOS：在使用者手勢裡播一段無聲的 `<audio>` 迴圈，把工作階段切到媒體播放（同樣的效果）。
 *   只在 iOS 做：Android 播 `<audio>` 會多出媒體通知，也可能被耳機／藍牙事件打斷。
 */

/** 是否為 iPhone／iPad（iPadOS 13+ 的 UA 會偽裝成 Mac，用觸控點數判斷） */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** navigator.audioSession（Safari 16.4+ 才有，TypeScript 內建型別還沒有） */
interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/** 瀏覽器支援 Audio Session API */
export function hasAudioSession(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as AudioSessionNavigator).audioSession;
}

/**
 * 把音訊工作階段設成媒體播放（iOS 16.4+）。建立或 resume AudioContext 之前呼叫。
 * 其他瀏覽器沒有這個 API，什麼都不做。
 */
export function preferPlaybackSession(): void {
  const s = (navigator as unknown as AudioSessionNavigator).audioSession;
  if (!s) return;
  try {
    if (s.type !== 'playback') s.type = 'playback';
  } catch {
    // 某些版本設定時會丟例外：放棄，維持預設
  }
}

/** 無聲迴圈用的 `<audio>` 元素（整個頁面只需要一個） */
let silentEl: HTMLAudioElement | null = null;

/** 產生一段 0.25 秒、8 kHz、8 位元單聲道的無聲 WAV（回傳 blob URL） */
function silentWavUrl(): string {
  const samples = 2000;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt 區塊大小
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 單聲道
  v.setUint32(24, 8000, true); // 取樣率
  v.setUint32(28, 8000, true); // 每秒位元組數
  v.setUint16(32, 1, true); // 區塊對齊
  v.setUint16(34, 8, true); // 8 位元
  text(36, 'data');
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 8 位元 PCM 的靜音值是 128
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * 舊版 iOS（沒有 Audio Session API）：在使用者手勢裡開始播放無聲迴圈，讓 Web Audio 不受靜音鍵影響。
 * 必須在手勢事件（touchend／click）的處理函式裡同步呼叫。
 */
export function startSilentLoopIfNeeded(): void {
  if (!isIOS() || hasAudioSession()) return;
  try {
    if (!silentEl) {
      silentEl = document.createElement('audio');
      silentEl.src = silentWavUrl();
      silentEl.loop = true;
      silentEl.setAttribute('playsinline', '');
      silentEl.preload = 'auto';
    }
    if (silentEl.paused) void silentEl.play().catch(() => {});
  } catch {
    // 播放失敗就算了（下一次手勢會再試）
  }
}
