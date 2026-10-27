/**
 * content.js - 注入「获取图片」悬浮按钮 + 提取页面所有商品图片
 * 运行环境：淘宝 / 天猫 / 京东 / 拼多多的商品详情页
 */
(function () {
  'use strict';

  /* ================= 商品详情页判断：只有商品页才显示按钮 ================= */
  const PRODUCT_URL_PATTERNS = [
    /item\.taobao\.com\/item\.htm/i,        // 淘宝商品页
    /detail\.tmall\.com\/item\.htm/i,       // 天猫商品页
    /item\.jd\.com\/\d+\.html/i,            // 京东商品页
    /goods\.html/i,                          // 拼多多商品页
    /mms\.pinduoduo\.com/i                  // 拼多多商家后台
  ];

  function isProductPage() {
    return PRODUCT_URL_PATTERNS.some((re) => re.test(location.href));
  }

  // 非商品详情页：不注入任何内容
  if (!isProductPage()) return;

  // 防止脚本被重复注入
  if (window.__imageGrabInjected) return;
  window.__imageGrabInjected = true;

  /* ================= 右下角悬浮按钮 ================= */
  const btn = document.createElement('button');
  btn.id = 'ig-float-btn';
  btn.textContent = '获取图片';
  btn.title = '提取本页所有商品图片';
  document.documentElement.appendChild(btn);

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = '提取中…';
    extractImages()
      .then((images) => {
        // 图片列表交给 background 存储并打开展示页
        chrome.runtime.sendMessage({ type: 'OPEN_GALLERY', images }, () => {
          // 忽略消息通道关闭等报错，只负责复位按钮
          void chrome.runtime.lastError;
          resetBtn();
        });
      })
      .catch((e) => {
        console.error('[ImageGrab] 提取失败：', e);
        resetBtn();
      });
  });

  function resetBtn() {
    btn.disabled = false;
    btn.textContent = '获取图片';
  }

  /* ================= 图片提取核心逻辑 ================= */

  // 垃圾图片特征：URL 中含这些关键词的直接排除（图标、logo、占位图等）
  const JUNK_KEYWORDS =
    /logo|icon|sprite|avatar|placeholder|blank|loading|spacer|pixel|badge|favicon|qrcode|wechat|weixin|alipay|btn[-_]|button[-_]|bg[-_]pic\.png/i;

  // base64 的 1x1 透明 gif 占位图
  const isBlankDataImage = (src) => /^data:image\/gif;base64,R0lGOD/i.test(src || '');

  /** 相对路径 → 绝对 URL；非法地址返回 null */
  function toAbs(u) {
    try {
      if (!u) return null;
      u = u.trim();
      if (u.startsWith('//')) return 'https:' + u;           // 协议相对地址
      if (/^https?:\/\//i.test(u)) return u;                  // 已是绝对地址
      if (u.startsWith('data:')) return u;                    // base64 图片
      return new URL(u, location.href).href;                  // 相对路径补全
    } catch (e) {
      return null;
    }
  }

  /** 解析 srcset，返回清晰度最高的一档 URL */
  function parseSrcset(srcset) {
    let best = null;
    let bestScore = -1;
    srcset.split(',').forEach((part) => {
      const seg = part.trim().split(/\s+/);
      const url = seg[0];
      const desc = seg[1] || '';
      let score = 0;
      if (/^[\d.]+w$/.test(desc)) score = parseFloat(desc);              // 宽度描述，如 800w
      else if (/^[\d.]+x$/.test(desc)) score = parseFloat(desc) * 1000;  // 像素比描述，如 2x
      if (url && score > bestScore) {
        bestScore = score;
        best = url;
      }
    });
    return best;
  }

  /** 收集页面里所有可能的图片 URL 原始池（含懒加载属性、srcset、背景图） */
  function collectRawUrls() {
    const urls = new Set();

    // 1) 所有 <img>：src + 常见懒加载属性 + srcset
    document.querySelectorAll('img').forEach((img) => {
      [
        img.getAttribute('src'),
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazyload'),
        img.getAttribute('data-actualsrc')
      ].forEach((u) => {
        const a = toAbs(u);
        if (a) urls.add(a);
      });

      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (srcset) {
        const best = parseSrcset(srcset);
        const a = toAbs(best);
        if (a) urls.add(a);
      }
    });

    // 2) 背景图 background-image: url(...)（含 CSS 类定义的背景）
    document.querySelectorAll('body *').forEach((el) => {
      let bg = '';
      try {
        bg = getComputedStyle(el).backgroundImage;
      } catch (e) {
        return;
      }
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) {
          const a = toAbs(m[1]);
          if (a) urls.add(a);
        }
      }
    });

    return [...urls];
  }

  /** 探测图片真实尺寸（3 秒超时，失败返回 null 表示尺寸未知） */
  function getImageSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 3000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.referrerPolicy = 'no-referrer'; // 减少防盗链对探测的影响
      img.src = url;
    });
  }

  /** 主流程：收集 → 过滤 → 去重 → 输出结构化列表 */
  async function extractImages() {
    const rawUrls = collectRawUrls();
    const seen = new Set();
    const result = [];

    for (const url of rawUrls) {
      if (seen.has(url)) continue;   // URL 去重
      seen.add(url);

      if (isBlankDataImage(url)) continue;                              // 1x1 占位图
      if (!url.startsWith('data:') && JUNK_KEYWORDS.test(url)) continue; // logo / 图标等

      const size = await getImageSize(url);
      // 已知尺寸且小于 100x100 的过滤；尺寸未知的保留（宁多勿漏）
      if (size && (size.w < 100 || size.h < 100)) continue;

      result.push({
        url,
        width: size ? size.w : 0,
        height: size ? size.h : 0
      });
    }

    return result;
  }
})();
