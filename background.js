/**
 * background.js - Service Worker（后台服务）
 * 职责：
 *   1. 接收 content 的图片列表，存入 storage 并打开 gallery 展示页
 *   2. 代替页面抓取图片并转成 dataURL（绕过跨域 / 防盗链）
 *   3. 调用 chrome.downloads 把 PNG 保存到默认下载目录
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ImageGrab] 插件已安装/更新');
});

/* ================= 消息中枢 ================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 1. content 发来：打开展示页
  if (msg.type === 'OPEN_GALLERY') {
    chrome.storage.local
      .set({ images: msg.images || [], savedAt: Date.now() })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') }))
      .catch((e) => console.error('[ImageGrab] 存储图片列表失败：', e));
    sendResponse({ ok: true });
    return;
  }

  // 2. gallery 发来：抓图并转 dataURL（解决跨域）
  if (msg.type === 'FETCH_IMAGE') {
    fetchAsDataURL(msg.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message) }));
    return true; // 保持通道打开，等待异步响应
  }

  // 3. gallery 发来：下载 PNG 文件
  if (msg.type === 'DOWNLOAD_FILE') {
    chrome.downloads.download(
      {
        url: msg.dataUrl,
        filename: msg.filename, // 如：商品图_001.png
        saveAs: false           // 不弹另存为对话框，直接进默认下载目录
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
    return true;
  }
});

/* ================= 抓取图片并转 base64 dataURL ================= */
async function fetchAsDataURL(url) {
  // base64 图无需抓取，直接原样返回
  if (url.startsWith('data:')) return url;

  const resp = await fetch(url, {
    credentials: 'include',        // 带上 cookie，兼容需要登录态的图片
    referrerPolicy: 'no-referrer'  // 去掉 referer，绕过部分防盗链
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);

  const blob = await resp.blob();

  // blob → base64（分块拼接，避免大图导致栈溢出）
  const buf = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
  return 'data:' + mime + ';base64,' + btoa(bin);
}
