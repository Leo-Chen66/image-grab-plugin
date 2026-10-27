/**
 * main.js - 官网交互脚本
 * 功能：汉堡菜单、导航吸顶阴影、滚动区块高亮、滚动进入动画
 */
(function () {
  'use strict';

  /* ---------- 1. 移动端汉堡菜单 ---------- */
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('nav-links');

  hamburger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });

  // 点击菜单项后自动收起（移动端）
  navLinks.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- 2. 导航栏吸顶阴影 ---------- */
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });

  /* ---------- 3. 滚动监听：高亮当前区块对应的导航项 ---------- */
  const sectionLinks = navLinks.querySelectorAll('a[data-section]');
  const sections = [...sectionLinks]
    .map((a) => document.getElementById(a.dataset.section))
    .filter(Boolean);

  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        sectionLinks.forEach((a) => {
          a.classList.toggle('active', a.dataset.section === entry.target.id);
        });
      });
    },
    // 视口上 1/3 处为判定线，谁跨过线谁高亮
    { rootMargin: '-33% 0px -60% 0px', threshold: 0 }
  );
  sections.forEach((s) => navObserver.observe(s));

  /* ---------- 4. 滚动进入视口时淡入上移 ---------- */
  const revealObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        obs.unobserve(entry.target); // 只播一次，之后不再监听
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
})();
