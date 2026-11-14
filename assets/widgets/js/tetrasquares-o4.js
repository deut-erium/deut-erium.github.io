(() => {
  'use strict';

  if (!('IntersectionObserver' in window) || !('animate' in Element.prototype)) return;

  document.querySelectorAll('[data-o4-animation]').forEach((figure) => {
    const pieces = Array.from(figure.querySelectorAll('[data-o4-piece]'));
    const gold = figure.querySelector('[data-o4-gold]');
    const replay = figure.querySelector('[data-o4-replay]');
    if (pieces.length !== 4 || !gold || !replay) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let animations = [];
    let generation = 0;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) play();
    }, { threshold: 0.5 });

    async function play() {
      if (motion.matches || replay.disabled) return;
      observer.unobserve(figure);
      const current = ++generation;
      animations.forEach((animation) => animation.cancel());
      replay.disabled = true;
      animations = pieces.map((piece, index) => piece.animate([
        { opacity: 1, transform: `translateY(-${piece.dataset.drop}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 500, delay: index * 600, easing: 'ease-in', fill: 'forwards' }));
      animations.push(gold.animate([
        { opacity: 0 },
        { opacity: 1 },
      ], { duration: 450, delay: 2600, fill: 'forwards' }));
      try {
        await Promise.all(animations.map((animation) => animation.finished));
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      } finally {
        if (current === generation) replay.disabled = false;
      }
    }

    function configure() {
      ++generation;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations = [];
      replay.disabled = false;
      replay.hidden = motion.matches;
      figure.classList.toggle('is-o4-animated', !motion.matches);
      if (!motion.matches) observer.observe(figure);
    }

    replay.addEventListener('click', play);
    motion.addEventListener('change', configure);
    configure();
  });
})();
