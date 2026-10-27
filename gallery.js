/**
 * gallery.js - 展示页逻辑：读取图片列表、网格展示、勾选、批量转 PNG 并下载
 */
(function () {
  'use strict';

  let images = [];           // [{url, width, height}]
  const selected = new Set(); // 已勾选的下标集合

  /* ================= DOM 引用 ================= */
  const grid = document.getElementById('grid');
  const emptyEl = document.getElementById('empty');
  const totalCountEl = document.getElementById('total-count');
  const selectedCountEl = document.getElementById('selected-count');
  const downloadBtn = document.getElementById('download-btn');
  const selectAllBtn = document.getElementById('select-all');
  const invertBtn = document.getElementById('invert-select');
  const progressWrap = document.getElementById('progress-wrap');
  const progressText = document.getElementById('progress-text');
  const progressInner = document.getElementById('progress-inner');
  const toast = document.getElementById('toast');

  /* ================= 初始化：从 storage 读取提取结果 ================= */
  async function init() {
    const data = await chrome.storage.local.get('images');
    images = data.images || [];
    if (!images.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    totalCountEl.textContent = images.length;
    renderGrid();
  }

  /* ================= 渲染图片网格 ================= */
  function renderGrid() {
    grid.innerHTML = '';
    images.forEach((item, index) => {
      const card = document.createElement('label');
      card.className = 'card';
      card.innerHTML = `
        <input type="checkbox" data-index="${index}" />
        <div class="thumb-wrap">
          <img src="${item.url}" referrerpolicy="no-referrer" loading="lazy" alt="商品图${index + 1}" />
        </div>
        <div class="meta">
          <span class="idx">#${pad(index + 1)}</span>
          <span class="size">${item.width ? item.width + '×' + item.height : '尺寸未知'}</span>
        </div>`;
      grid.appendChild(card);
    });

    // 勾选事件：同步 selected 集合与卡片高亮
    grid.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.index);
        if (cb.checked) selected.add(i);
        else selected.delete(i);
        cb.closest('.card').classList.toggle('checked', cb.checked);
        updateBar();
      });
    });
  }

  /** 序号补零：1 → 001 */
  function pad(n) {
    return String(n).padStart(3, '0');
  }

  /* ================= 顶栏状态刷新 ================= */
  function updateBar() {
    selectedCountEl.textContent = selected.size;
    downloadBtn.disabled = selected.size === 0;
  }

  /* ================= 全选 / 反选 ================= */
  selectAllBtn.addEventListener('click', () => {
    const boxes = grid.querySelectorAll('input[type=checkbox]');
    const allChecked = [...boxes].every((b) => b.checked);
    boxes.forEach((b) => {
      b.checked = !allChecked;
      b.dispatchEvent(new Event('change'));
    });
  });

  invertBtn.addEventListener('click', () => {
    grid.querySelectorAll('input[type=checkbox]').forEach((b) => {
      b.checked = !b.checked;
      b.dispatchEvent(new Event('change'));
    });
  });

  /* ================= 下载选中（主流程） ================= */
  downloadBtn.addEventListener('click', async () => {
    const list = [...selected].sort((a, b) => a - b).map((i) => images[i]);
    if (!list.length) return;

    downloadBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    setProgress(0);

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      progressText.textContent = `转换下载中 ${i + 1}/${list.length}`;
      setProgress(i / list.length);
      try {
        // 1. 抓图 + canvas 转 PNG
        const pngDataUrl = await toPngDataUrl(list[i].url);
        // 2. 交给 background 保存到下载目录
        const res = await sendMsg({
          type: 'DOWNLOAD_FILE',
          dataUrl: pngDataUrl,
          filename: `商品图_${pad(i + 1)}.png`
        });
        if (res && res.ok) ok++;
        else fail++;
      } catch (e) {
        console.warn('[ImageGrab] 单图下载失败：', list[i].url, e);
        fail++;
      }
    }

    setProgress(1);
    const summary = `下载完成：成功 ${ok} 张${fail ? '，失败 ' + fail + ' 张' : ''}`;
    progressText.textContent = summary;
    showToast(summary);
    downloadBtn.disabled = false;
    setTimeout(() => progressWrap.classList.add('hidden'), 2500);
  });

  /* ================= 任意格式 → PNG dataURL ================= */
  async function toPngDataUrl(url) {
    // 1. 让 background 抓图（绕过页面防盗链与跨域限制）
    const res = await sendMsg({ type: 'FETCH_IMAGE', url });
    if (!res || !res.ok || !res.dataUrl) {
      throw new Error(res && res.error ? res.error : '抓图失败');
    }

    // 2. 解码为 Image 对象
    const img = await loadImage(res.dataUrl);

    // 3. canvas 绘制并导出 PNG（统一格式转换）
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** 加载图片（dataURL 不会触发跨域问题） */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = src;
    });
  }

  /** 发消息给 background 的 Promise 封装 */
  function sendMsg(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res);
        }
      });
    });
  }

  /* ================= 进度与提示 ================= */
  function setProgress(ratio) {
    progressInner.style.width = Math.round(ratio * 100) + '%';
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  init();
})();
